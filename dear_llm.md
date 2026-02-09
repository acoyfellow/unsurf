# unsurf — Agent Guidance

## North Star

**Turn any website into a typed API.** An agent visits a site, captures every API call under the hood, and gives you back an OpenAPI spec and replayable execution paths. No reverse engineering. No docs. No browser needed after the first pass.

Three MCP tools: **Scout** (explore + capture), **Worker** (replay API directly), **Heal** (re-scout + diff + patch when sites change).

## Stack

- **Effect** — typed errors, DI via Layer/Context.Tag, streams, retries, Scope for resource safety
- **Alchemy** (v0.84.0) — infrastructure as TypeScript (replaces wrangler.toml). Handles D1 migrations automatically on deploy
- **Drizzle** — typed SQL schema + queries (D1/SQLite)
- **Cloudflare Workers** — edge runtime
- **Cloudflare Browser Rendering** — headless Chrome via `@cloudflare/puppeteer`
- **D1** + **R2** — storage
- **tsup** — build tool for NPM package (ESM + DTS)
- **Biome** — lint + format (tabs, 100 line width). Ignores: `docs/`, `migrations/`
- **Vitest** — 75 tests across 8 files
- **Astro Starlight** — docs site at https://unsurf.coey.dev

## Architecture

Every service is a `Context.Tag` with a live impl (CF bindings) and a test impl (in-memory).

```
src/
├── index.ts                  # NPM package barrel export (36 exports)
├── cf-worker.ts              # CF Worker entry point (routing, CORS, layer building)
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
│   └── Heal.ts               # Retry w/ backoff → re-scout → retry
└── lib/
    └── url.ts                # URL pattern normalization
```

## NPM Package

- **Name**: `unsurf` on NPM
- **Version**: 0.1.0
- **Entry**: `dist/index.js` (ESM), `dist/index.d.ts` (types)
- **Exports**: 36 public symbols — tools, services, domain types, utilities, db
- **Build**: `bun run build` (tsup)
- **Prepublish**: `bun run prepublishOnly` → check + typecheck + test + build
- **Files included**: `dist/`, `src/` (excluding `cf-worker.ts`)
- **External deps**: effect, @effect/platform, @effect/schema, drizzle-orm, @cloudflare/puppeteer

## Live Deployment

- **Worker URL**: https://unsurf.coy.workers.dev
- **D1 Database**: `unsurf-unsurf-db-exedev` (ID: `732baf90-e109-4875-b4a9-e668e54b1eea`)
- **R2 Bucket**: `unsurf-unsurf-storage-exedev`
- **Compatibility**: `nodejs_compat`, `nodejs_compat_populate_process_env`
- **Alchemy state**: `.alchemy/unsurf/exedev/`

## Conventions

- `exactOptionalPropertyTypes: true` — always use `?: T | undefined` not just `?: T`
- `Schema.optionalWith(..., { as: "Option" })` produces `Option<T>` — use `Option.isSome/getOrUndefined`
- CI: `check` job (biome + tsc + vitest), `docs` job (astro build + deploy), `deploy` job (alchemy deploy + smoke test)
- Pre-push hook scans for secrets

## Status

**Phases 1–10 complete.** 75 tests passing. Worker deployed. NPM package built.

| Layer | State | Details |
|---|---|---|
| Domain types | ✅ | 5 Effect Schema classes in `src/domain/` |
| Database | ✅ | Drizzle schema, queries, migration |
| Store service | ✅ | D1+R2 live + in-memory test impl |
| Browser service | ✅ | CF Puppeteer + Scope lifecycle + test doubles |
| Schema Inferrer | ✅ | JSON→JSON Schema, format detection, merging |
| OpenAPI Generator | ✅ | Endpoints→OpenAPI 3.1 |
| Scout tool | ✅ | navigate→capture→infer→save→spec |
| Worker tool | ✅ | Direct HTTP replay, smart endpoint selection |
| Heal tool | ✅ | Retry w/ backoff → re-scout → retry |
| Entry point | ✅ | Routes, CORS, layer building, errors |
| Tests | ✅ | 75 passing, 8 files |
| Lint/Types | ✅ | Biome + tsc clean |
| NPM package | ✅ | tsup build, barrel export, 36 symbols |
| CF deploy | ✅ | https://unsurf.coy.workers.dev |
| CI | ✅ | check → docs → deploy pipeline |
| Docs | ✅ | https://unsurf.coey.dev |
| NPM publish | ⏳ | v0.1.0 ready, needs OTP for 2FA |

### What remains (future)

1. **MCP server** — Not yet implemented. The README mentions MCP but the current API is plain HTTP POST. Adding an MCP transport layer (stdio or SSE) is a future enhancement.
2. **TypeScript client codegen** — `src/lib/codegen.ts` referenced in README but not built. Future.
3. **LLM-guided scout** — `src/ai/` not built. Future enhancement where an LLM decides what to click/fill during scouting.
4. **E2E smoke test** — POST /tools/scout against live URL with a real site. Browser Rendering may require CF Workers Paid plan.

### Known issues

- Browser Rendering requires a paid Cloudflare Workers plan
- CI `docs` and `deploy` jobs need GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`
- NPM publish requires 2FA OTP: `npm publish --otp=CODE`

## Links

- Repo: https://github.com/acoyfellow/unsurf
- NPM: https://www.npmjs.com/package/unsurf
- Docs: https://unsurf.coey.dev
- Worker: https://unsurf.coy.workers.dev
