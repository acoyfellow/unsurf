# unsurf — Agent Guidance

## North Star

**Turn any website into a typed API.** An agent visits a site, captures every API call under the hood, and gives you back an OpenAPI spec and replayable execution paths. No reverse engineering. No docs. No browser needed after the first pass.

Three MCP tools: **Scout** (explore + capture), **Worker** (replay API directly), **Heal** (re-scout + diff + patch when sites change).

## Stack

- **Effect** — typed errors, DI via Layer/Context.Tag, streams, retries, Scope for resource safety
- **Alchemy** — infrastructure as TypeScript (replaces wrangler.toml). Handles D1 migrations automatically on deploy — users never run `drizzle-kit generate`
- **Drizzle** — typed SQL schema + queries (D1/SQLite)
- **Cloudflare Workers** — edge runtime
- **Cloudflare Browser Rendering** — headless Chrome via `@cloudflare/puppeteer`
- **D1** + **R2** — storage
- **Biome** — lint + format (tabs, 100 line width). Ignores: `docs/`, `migrations/`
- **Vitest** — 75 tests across 8 files
- **Astro Starlight** — docs site at https://unsurf.coey.dev

## Architecture

Every service is a `Context.Tag` with a live impl (CF bindings) and a test impl (in-memory).

```
src/
├── index.ts                  # Worker entry point (routing, CORS, layer building)
├── Api.ts                    # HttpApi definition (schema for scout/worker/heal)
├── ApiLive.ts                # HttpApiBuilder handlers (reference, not used in routing)
├── domain/                   # Effect Schema definitions
│   ├── Endpoint.ts           # CapturedEndpoint
│   ├── Path.ts               # ScoutedPath + PathStep
│   ├── NetworkEvent.ts       # CDP event schema + API filtering
│   ├── Errors.ts             # Tagged errors (BrowserError, StoreError, etc.)
│   └── Site.ts               # Site metadata
├── db/                       # Drizzle schema + queries
│   ├── schema.ts             # Table definitions
│   └── queries.ts            # Typed CRUD helpers
├── services/                 # Effect services
│   ├── Browser.ts            # CF Puppeteer impl + test doubles
│   ├── Store.ts              # D1+R2 live impl + in-memory test impl
│   ├── SchemaInferrer.ts     # JSON → JSON Schema
│   └── OpenApiGenerator.ts   # Endpoints → OpenAPI 3.1
├── tools/                    # MCP tool implementations
│   ├── Scout.ts              # Navigate, capture, infer, save, generate spec
│   ├── Worker.ts             # Replay via direct HTTP (no browser)
│   └── Heal.ts               # Retry + re-scout + patch
└── lib/
    └── url.ts                # URL pattern normalization
```

## Conventions

- `exactOptionalPropertyTypes: true` — always use `?: T | undefined` not just `?: T`
- `Schema.optionalWith(..., { as: "Option" })` produces `Option<T>` — use `Option.isSome/getOrUndefined`
- CI: `check` job (biome + tsc + vitest), `docs` job (astro build + deploy)
- Pre-push hook scans for secrets

## Status

Phases 1–9 complete. **75 tests passing.** All tools implemented and wired to Worker entry point.

**Phase 10 (Infrastructure)** remains: deploy worker to Cloudflare via Alchemy, custom domain, CI for worker deploy, e2e smoke test.

**Future work** (not started): `src/ai/` (LLM-guided scout agent), `src/lib/codegen.ts` (TypeScript client generation).

## Links

- Repo: https://github.com/acoyfellow/unsurf
- Docs: https://unsurf.coey.dev
