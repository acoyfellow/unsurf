# AGENTS.md — unsurf

## What This Is

**Turn any website into a typed API.** Scout captures network traffic, infers schemas, outputs OpenAPI. Worker replays endpoints directly. Heal re-scouts when paths break.

- **MCP Server**: https://unsurf-api.coey.dev/mcp
- **Docs**: https://unsurf.coey.dev
- **Directory**: https://unsurf.coey.dev/directory
- **NPM**: `unsurf`

## Stack

- **Effect** — typed errors, DI, streams, retries
- **Alchemy** — infrastructure as TypeScript 
- **Drizzle** — typed SQL (D1/SQLite)
- **Cloudflare Workers** — edge runtime
- **Cloudflare Browser Rendering** — headless Chrome

## Architecture

```
src/
├── cf-worker.ts              # Worker entry point
├── mcp.ts                    # MCP server entry point
├── cli.ts                    # CLI (unsurf search/lookup/publish)
├── domain/                   # Effect Schema types
├── db/                       # Drizzle schema + queries  
├── services/                 # Browser, Store, SchemaInferrer, OpenApiGenerator, Gallery, Directory
├── tools/                    # Scout, Worker, Heal
└── ai/                       # LLM Scout Agent (ScoutAgent, AnthropicProvider)
```

## Directory

The **API Directory** is a community registry of unsurfed APIs at `/directory`.

### Endpoints

```
GET    /d/                       # List all fingerprints
GET    /d/:domain                # Get domain info + capabilities  
GET    /d/:domain/:capability    # Get endpoints for capability
GET    /d/:domain/:method/:path  # Get specific endpoint details
GET    /d/:domain/spec           # Get OpenAPI spec
POST   /d/publish                # Publish scouted API to directory
POST   /d/validate               # Validate before publishing
DELETE /d/:domain                # Remove from directory
GET    /search?q=...             # Semantic search across directory
```

### Seeding

Curated seed list at `scripts/seed-apis.json`. Run seeding script:

```bash
bun run scripts/seed.ts
```

## Conventions

- `exactOptionalPropertyTypes: true`
- Biome for lint/format (tabs, 100 width)
- CI: check → docs → deploy

## Development

```bash
bun install
bun run dev          # Local worker
bun run test         # Vitest
bun run check        # Biome
bun run typecheck    # tsc
bun run deploy       # Alchemy deploy
```

## Links

- Repo: https://github.com/acoyfellow/unsurf
- Worker: https://unsurf-api.coey.dev
- Docs: https://unsurf.coey.dev
