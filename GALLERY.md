# API Gallery — Architecture

## What it is

A community-contributed registry of "unsurfed" APIs. Every time anyone scouts a site, the OpenAPI spec gets published to the gallery. Agents search the gallery before scouting — if someone already unsurfed that site, skip the browser entirely.

**One line:** _Scout once, share forever._

## Search requirements

Agents will search by:
1. **Domain** — "does gallery have anything for stripe.com?" (exact/prefix match)
2. **Endpoint path** — "is there a /api/users endpoint anywhere?" (substring)
3. **Task description** — "find a contact form submission API" (fuzzy/semantic)

#1 and #2 are cheap (exact match + LIKE). #3 is where it gets expensive.

## Architecture: D1 FTS5 + KV cache

```
Agent                    Gallery Worker              D1 (FTS5)         KV (cache)
  │                           │                         │                  │
  │  GET /gallery?q=stripe    │                         │                  │
  │──────────────────────────▶│                         │                  │
  │                           │  KV.get("q:stripe")     │                  │
  │                           │────────────────────────────────────────────▶│
  │                           │◀────────────────────────────────────────────│
  │                           │  (cache miss)           │                  │
  │                           │  FTS5 MATCH 'stripe'    │                  │
  │                           │────────────────────────▶│                  │
  │                           │◀────────────────────────│                  │
  │                           │  KV.put("q:stripe",res) │                  │
  │                           │────────────────────────────────────────────▶│
  │  { sites, specs }         │                         │                  │
  │◀──────────────────────────│                         │                  │
```

### Why this works

- **D1 FTS5** handles keyword search across domains, paths, and task descriptions. Free tier: 5M reads/day. SQLite FTS5 is battle-tested and fast for this scale.
- **KV cache** sits in front for hot queries. Same domain gets searched repeatedly by different agents? Served from cache in <5ms. TTL: 1 hour (specs don't change that fast). Free tier: 100K reads/day.
- **No Vectorize needed (yet)**. Semantic search is nice-to-have, not must-have. Agents are good at reformulating queries. Exact domain match + FTS5 keyword search covers 90% of use cases. Add Vectorize later if needed.
- **R2 stores full specs**. Gallery table stores metadata (domain, paths, task, endpoint count). Full OpenAPI JSON lives in R2. Only fetched when agent wants the actual spec.

### Why NOT other approaches

| Approach | Problem |
|---|---|
| Vectorize-first | Overkill for v1. Most searches are "do you have stripe.com?" — exact match. |
| Algolia/Meilisearch | External dependency. Unsurf is self-hosted on CF. Keep it that way. |
| KV-only (no D1) | KV can't search. You'd need to know the exact key. |
| D1-only (no KV) | Works, but gallery reads are bursty (many agents hit same popular domains). KV absorbs the spikes. |
| DO-based | Durable Objects are for stateful sessions, not search indexes. Wrong tool. |

## Schema

```sql
-- New table in existing D1 database
CREATE TABLE gallery (
  id            TEXT PRIMARY KEY,
  domain        TEXT NOT NULL,
  url           TEXT NOT NULL,
  task          TEXT NOT NULL,           -- what the scout was looking for
  endpoint_count INTEGER NOT NULL,
  endpoints_summary TEXT NOT NULL,       -- "GET /users, POST /users, GET /posts/:id" (searchable)
  spec_key      TEXT NOT NULL,           -- R2 key for full OpenAPI JSON
  contributor   TEXT DEFAULT 'anonymous', -- who scouted it
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1  -- increments on re-scout
);

-- FTS5 virtual table for search
CREATE VIRTUAL TABLE gallery_fts USING fts5(
  domain,
  url,
  task,
  endpoints_summary,
  content=gallery,
  content_rowid=rowid
);

-- Triggers to keep FTS in sync
CREATE TRIGGER gallery_ai AFTER INSERT ON gallery BEGIN
  INSERT INTO gallery_fts(rowid, domain, url, task, endpoints_summary)
  VALUES (new.rowid, new.domain, new.url, new.task, new.endpoints_summary);
END;

CREATE TRIGGER gallery_ad AFTER DELETE ON gallery BEGIN
  INSERT INTO gallery_fts(gallery_fts, rowid, domain, url, task, endpoints_summary)
  VALUES ('delete', old.rowid, old.domain, old.url, old.task, old.endpoints_summary);
END;

CREATE TRIGGER gallery_au AFTER UPDATE ON gallery BEGIN
  INSERT INTO gallery_fts(gallery_fts, rowid, domain, url, task, endpoints_summary)
  VALUES ('delete', old.rowid, old.domain, old.url, old.task, old.endpoints_summary);
  INSERT INTO gallery_fts(rowid, domain, url, task, endpoints_summary)
  VALUES (new.rowid, new.domain, new.url, new.task, new.endpoints_summary);
END;

-- Index for exact domain lookups (most common query)
CREATE INDEX idx_gallery_domain ON gallery(domain);
```

## API

### `GET /gallery?q=<query>&domain=<domain>&limit=<n>`

Search the gallery. At least one of `q` or `domain` required.

- `domain` — exact match (fast path, checks KV first)
- `q` — FTS5 keyword search across domain, URL, task, endpoints
- `limit` — max results (default 10, max 50)

**Response:**
```json
{
  "results": [
    {
      "id": "gal_abc123",
      "domain": "stripe.com",
      "url": "https://stripe.com/dashboard",
      "task": "find payment API endpoints",
      "endpointCount": 12,
      "endpointsSummary": "GET /api/charges, POST /api/charges, GET /api/customers, ...",
      "contributor": "anonymous",
      "updatedAt": "2024-01-15T10:00:00Z",
      "version": 2
    }
  ],
  "total": 1
}
```

### `GET /gallery/:id/spec`

Fetch the full OpenAPI spec from R2.

**Response:** OpenAPI 3.1 JSON

### `POST /gallery/publish`

Publish a scouted API to the gallery. Called automatically after scout (opt-in).

```json
{
  "siteId": "site_abc123",
  "contributor": "anonymous"
}
```

Pulls site, endpoints, and spec from the existing D1/R2 data. Deduplicates by domain — if the domain already exists, increments `version` and updates.

## MCP tool

```json
{
  "name": "gallery",
  "description": "Search the API gallery for previously unsurfed sites. Check here before scouting — someone may have already captured the API you need.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search term (domain, endpoint path, or description)" },
      "domain": { "type": "string", "description": "Exact domain to look up" }
    }
  }
}
```

## Integration with scout

The gallery hooks into the existing scout flow:

```
scout(url, task)
  │
  ├─ 1. Check gallery for domain  ──▶  found? return cached spec (skip browser)
  │
  ├─ 2. No hit → run normal scout
  │
  └─ 3. After scout succeeds → publish to gallery (if opt-in)
```

This means the gallery is both a **read cache** (check before scouting) and a **write-through cache** (populated by scouting). The more people scout, the more the gallery knows.

## Scaling path

| Stage | Search | Cache | Cost |
|---|---|---|---|
| **v1 (now)** | D1 FTS5 | KV (1hr TTL) | Free tier |
| **v2 (1K+ specs)** | D1 FTS5 + domain index | KV (1hr TTL) | Free tier |
| **v3 (10K+ specs)** | Add Vectorize for semantic search | KV + R2 CDN | ~$5/mo |
| **v4 (100K+ specs)** | Vectorize + FTS5 hybrid | KV + CDN + read replicas | ~$20/mo |

Start simple. D1 FTS5 handles thousands of specs easily. Add Vectorize only when keyword search stops being good enough.

## Implementation order

1. **Schema migration** — add `gallery` + `gallery_fts` tables
2. **Gallery service** — Effect service with `search`, `publish`, `getSpec`
3. **KV cache layer** — wrap reads with KV get/put
4. **REST endpoints** — `GET /gallery`, `GET /gallery/:id/spec`, `POST /gallery/publish`
5. **MCP tool** — `gallery` tool in MCP server
6. **Scout integration** — optional auto-publish after scout
7. **Docs page** — guide + gallery browser UI
