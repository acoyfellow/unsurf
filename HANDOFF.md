# HANDOFF — API Gallery: Scout → Ship

> **For:** Orchestrator agent overseeing parallel workers
> **Goal:** Gallery feature live, typed, tested, e2e-gated in prod
> **Date:** Feb 9, 2026

---

## Context

**unsurf** turns any website into a typed API. Three MCP tools: Scout (browser+CDP→OpenAPI), Worker (HTTP replay), Heal (retry+re-scout). Deployed at https://unsurf-api.coey.dev. 94 tests, 10 files, zero TODOs.

The **API Gallery** is the next feature: a community registry of unsurfed APIs. Agents search before scouting — skip the browser if someone already captured that site's API. Architecture doc: `GALLERY.md`.

## Architecture (decided)

- **D1 FTS5** for keyword search (domain, paths, task descriptions)
- **KV** for caching hot queries (1hr TTL)
- **R2** for full OpenAPI spec storage (already in use)
- **No Vectorize** in v1 — exact domain match + FTS5 keyword search covers 90%
- Schema, API design, MCP tool, and scaling path are all in `GALLERY.md`

## Stack

- **Effect-TS** — every service is a `Context.Tag`, errors are `Schema.TaggedError`, DI via `Layer`
- **Drizzle ORM** on D1 (SQLite) — typed schemas in `src/db/schema.ts`, queries in `src/db/queries.ts`
- **Alchemy** — infra-as-code in `alchemy.run.ts` (D1, R2, KV, Browser Rendering, Worker)
- **Cloudflare Workers** — entry point is `src/cf-worker.ts` (manual routing, not Effect HttpApi)
- **MCP** — `src/mcp.ts` uses `@modelcontextprotocol/sdk`, stateless Streamable HTTP at `/mcp`
- **Biome** — lint+format (tabs, 100 width). Run `npx biome check .`
- **Vitest** — `npx vitest run`. Currently 94 tests across 10 files
- **tsup** — builds NPM package. `bun run build`

## Critical conventions

- `exactOptionalPropertyTypes: true` — use `?: T | undefined` not `?: T`
- `Schema.optionalWith(..., { as: "Option" })` produces `Option<T>` — use `Option.isSome/getOrUndefined`
- Every service: `Context.Tag` → live impl (CF bindings) + test impl (in-memory)
- Examples in `examples/` are dogfooded — imported from `unsurf`, tested by `test/examples.test.ts`, embedded in docs via `<SourceCode>` component
- Pre-push hook scans for secrets
- No `any` types anywhere. Biome enforces this.

## File map

```
src/
├── index.ts              # Barrel export (all public symbols)
├── cf-worker.ts          # CF Worker entry (routing, CORS, layers)
├── mcp.ts                # MCP server (Streamable HTTP)
├── domain/               # Effect Schema types
│   ├── Endpoint.ts       # CapturedEndpoint
│   ├── Path.ts           # ScoutedPath, PathStep  
│   ├── NetworkEvent.ts   # CDP events + isApiRequest filter
│   ├── Errors.ts         # 5 TaggedErrors
│   └── Site.ts           # Site metadata
├── db/
│   ├── schema.ts         # Drizzle table definitions
│   └── queries.ts        # Typed CRUD
├── services/
│   ├── Browser.ts        # CF Puppeteer + test doubles
│   ├── Store.ts          # D1+R2 live + in-memory test
│   ├── SchemaInferrer.ts # JSON → JSON Schema
│   └── OpenApiGenerator.ts # Endpoints → OpenAPI 3.1
├── tools/
│   ├── Scout.ts          # Navigate → capture → infer → save
│   ├── Worker.ts         # HTTP replay (fast) or browser (slow)
│   └── Heal.ts           # Retry → re-scout → diff → patch
├── ai/
│   ├── ScoutAgent.ts     # LLM-driven exploration
│   └── AnthropicProvider.ts
└── lib/
    ├── url.ts            # normalizeUrlPattern, extractDomain
    └── codegen.ts        # OpenAPI → typed fetch client

examples/                 # 7 runnable files, tested in CI
test/                     # 10 test files, 94 tests
migrations/               # Drizzle SQL migrations
GALLERY.md                # Architecture doc for this feature
```

---

## Work breakdown — 7 tasks, parallelizable

### Task 1: Schema migration
**File:** `src/db/schema.ts`, `migrations/`
**Do:**
- Add `gallery` table to Drizzle schema (see `GALLERY.md` for columns)
- Add `gallery_fts` FTS5 virtual table + sync triggers
- Add `idx_gallery_domain` index
- Run `npx drizzle-kit generate` to create migration SQL
- Verify migration applies cleanly

**Test:** Migration file exists and is valid SQL. Drizzle schema types export correctly.
**Depends on:** Nothing

### Task 2: Gallery service
**File:** `src/services/Gallery.ts`
**Do:**
- `Context.Tag("Gallery")` with interface:
  - `search(query: string, domain?: string, limit?: number)` → `Effect<GalleryEntry[], StoreError>`
  - `publish(siteId: string, contributor?: string)` → `Effect<GalleryEntry, StoreError>`  
  - `getSpec(galleryId: string)` → `Effect<Record<string, unknown>, StoreError | NotFoundError>`
  - `getByDomain(domain: string)` → `Effect<GalleryEntry | null, StoreError>`
- `GalleryLive` layer: D1 FTS5 queries + R2 spec fetch
- `GalleryTestLive` layer: in-memory Map implementation
- KV cache: wrap `search` and `getByDomain` with KV get/put (1hr TTL)

**Pattern to follow:** Look at `src/services/Store.ts` for the exact Effect service pattern.
**Test:** `test/Gallery.test.ts` — publish, search by domain, search by keyword, FTS ranking, cache hit/miss, deduplication on re-publish
**Depends on:** Task 1 (schema)

### Task 3: Domain type
**File:** `src/domain/Gallery.ts`
**Do:**
- `GalleryEntry` Effect Schema class:
  ```typescript
  export class GalleryEntry extends Schema.Class<GalleryEntry>("GalleryEntry")({
    id: Schema.String,
    domain: Schema.String,
    url: Schema.String,
    task: Schema.String,
    endpointCount: Schema.Number,
    endpointsSummary: Schema.String,
    specKey: Schema.String,
    contributor: Schema.String,
    createdAt: Schema.String,
    updatedAt: Schema.String,
    version: Schema.Number,
  }) {}
  ```
- Add `GalleryError` to `src/domain/Errors.ts` if needed
- Export from `src/index.ts`

**Depends on:** Nothing

### Task 4: REST endpoints + MCP tool
**File:** `src/cf-worker.ts`, `src/mcp.ts`
**Do:**
- Add routes to `cf-worker.ts`:
  - `GET /gallery?q=<query>&domain=<domain>&limit=<n>` → search
  - `GET /gallery/:id/spec` → fetch full OpenAPI spec from R2
  - `POST /gallery/publish` → publish scouted site to gallery
- Add `gallery` tool to MCP server in `src/mcp.ts`
- Wire Gallery service layer into worker's layer composition

**Pattern to follow:** Look at existing routes in `cf-worker.ts` for the routing pattern. Look at `src/mcp.ts` for tool registration pattern.
**Depends on:** Task 2 (service), Task 3 (domain type)

### Task 5: Scout integration
**File:** `src/tools/Scout.ts`
**Do:**
- Before scouting: check gallery for domain → if found, return cached spec (skip browser)
- After successful scout: optionally publish to gallery
- Add `publish` flag to `ScoutInput` (default: `true`)
- Add `fromGallery` flag to `ScoutResult` (true when served from cache)

**Careful:** This modifies the core scout flow. Don't break existing tests. Gallery check should be optional — if Gallery service isn't in the layer, skip it.
**Depends on:** Task 2 (service)

### Task 6: Dogfooded example + docs
**Files:** `examples/gallery-search.ts`, `docs/src/content/docs/guides/gallery.mdx`
**Do:**
- Example file that imports from `unsurf` and demonstrates gallery search + publish
- Add test cases to `test/examples.test.ts` for the new example
- Write docs guide: "How to use the API Gallery" (Diátaxis how-to guide)
- Add to sidebar in `docs/astro.config.mjs`
- Embed example via `<SourceCode file="examples/gallery-search.ts" />`

**Depends on:** Task 2, Task 3, Task 4

### Task 7: E2E gate
**File:** `test/gallery-e2e.test.ts` or CI workflow
**Do:**
- Integration test that runs the full flow against the test layers:
  1. Scout a site (test browser with fixtures)
  2. Publish to gallery
  3. Search gallery — verify the site appears
  4. Scout same domain again — verify gallery cache hit (no browser)
  5. Search by endpoint path — verify FTS5 finds it
  6. Fetch full spec — verify valid OpenAPI
- If possible, add a smoke test in CI that hits the deployed worker:
  - `POST /gallery/publish` with a known siteId
  - `GET /gallery?domain=<domain>` — verify 200 + result

**Depends on:** Tasks 1-5 all complete

---

## Parallelism map

```
  Task 1 (schema) ──────┐
                         ├──▶ Task 2 (service) ──┬──▶ Task 4 (endpoints) ──┐
  Task 3 (domain type) ──┘                       │                         ├──▶ Task 6 (docs)
                                                 ├──▶ Task 5 (scout hook)  │
                                                 │                         ├──▶ Task 7 (e2e)
                                                 └─────────────────────────┘
```

- **Wave 1** (parallel): Task 1 + Task 3
- **Wave 2** (needs wave 1): Task 2
- **Wave 3** (parallel, needs wave 2): Task 4 + Task 5
- **Wave 4** (needs wave 3): Task 6 + Task 7

## Alchemy infra changes

The gallery needs a **KV namespace** added to `alchemy.run.ts`:

```typescript
import { KVNamespace } from "alchemy/cloudflare";

const CACHE = await KVNamespace("unsurf-gallery-cache");

// Add to Worker bindings:
const WORKER = await Worker("unsurf", {
  entrypoint: "./src/cf-worker.ts",
  bindings: { DB, STORAGE, BROWSER, CACHE },
  url: true,
});
```

## Definition of done

- [ ] `gallery` + `gallery_fts` tables in D1 via migration
- [ ] `Gallery` Effect service with live + test implementations
- [ ] `GalleryEntry` domain type exported from `src/index.ts`
- [ ] `GET /gallery`, `GET /gallery/:id/spec`, `POST /gallery/publish` endpoints
- [ ] `gallery` MCP tool registered and functional
- [ ] Scout checks gallery before launching browser
- [ ] Scout publishes to gallery after success (opt-in, default true)
- [ ] KV cache layer on gallery reads (1hr TTL)
- [ ] All existing 94 tests still pass
- [ ] New tests: Gallery service (8+), examples dogfood (2+), e2e integration (5+)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Docs guide page for gallery
- [ ] Deployed to https://unsurf-api.coey.dev
- [ ] Smoke test passes against prod

## What NOT to do

- Don't add Vectorize. FTS5 is enough for v1.
- Don't change the existing scout/worker/heal signatures in breaking ways.
- Don't add external dependencies. Stay on CF stack.
- Don't use `any`. Biome will catch it.
- Don't skip the test impl (`GalleryTestLive`). Every service needs one.
- Don't put full OpenAPI specs in D1. They go in R2. D1 gets metadata only.

## Verification commands

```bash
# Type check
npx tsc --noEmit

# Lint + format
npx biome check .

# All tests
npx vitest run

# Just gallery tests
npx vitest run test/Gallery.test.ts

# Build NPM package
bun run build

# Deploy
CLOUDFLARE_API_TOKEN=<token> bun run deploy
```
