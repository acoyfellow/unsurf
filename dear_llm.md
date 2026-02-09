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
- **Exports**: 44 public symbols — tools, services, domain types, utilities, db, MCP, AI agent
- **Build**: `bun run build` (tsup)
- **Prepublish**: `bun run prepublishOnly` → check + typecheck + test + build
- **Files included**: `dist/`, `src/` (excluding `cf-worker.ts`)
- **External deps**: effect, @effect/platform, @effect/schema, drizzle-orm, @cloudflare/puppeteer, @modelcontextprotocol/sdk, zod

## Live Deployment

- **Worker URL**: https://unsurf.coy.workers.dev
- **Alchemy stage**: `production` (pinned in alchemy.run.ts, not hostname-derived)
- **Alchemy state**: `CloudflareStateStore` (Durable Object on CF, used when `ALCHEMY_STATE_TOKEN` is set)
- **D1 Database**: `unsurf-unsurf-db-production`
- **R2 Bucket**: `unsurf-unsurf-storage-production`
- **Compatibility**: `nodejs_compat`, `nodejs_compat_populate_process_env`

## Conventions

- `exactOptionalPropertyTypes: true` — always use `?: T | undefined` not just `?: T`
- `Schema.optionalWith(..., { as: "Option" })` produces `Option<T>` — use `Option.isSome/getOrUndefined`
- CI: `check` job (biome + tsc + vitest), `docs` job (astro build + deploy), `deploy` job (alchemy deploy + smoke test)
- Pre-push hook scans for secrets

## Status

**All phases complete (1-10).** 79 tests passing across 9 files. Worker deployed. NPM package published. MCP server live. AI agent built.

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
| NPM publish | ✅ | v0.1.0 live on npmjs.com |
| MCP server | ✅ | Streamable HTTP at /mcp, 3 tools (+ agent-scout with API key) |
| AI Scout Agent | ✅ | LlmProvider interface, Anthropic adapter, 4 tests |

### What remains (future)

1. ~~**MCP server**~~ — **Done.** Phase 8 complete. MCP Streamable HTTP at `/mcp` using `@modelcontextprotocol/sdk`. Stateless mode. All 3 tools registered with Zod input schemas.
2. ~~**LLM Scout Agent**~~ — **Done.** Phase 9 complete. `src/ai/ScoutAgent.ts` with `LlmProvider` interface + `AnthropicProvider`. MCP `agent-scout` tool when `ANTHROPIC_API_KEY` is set. 4 tests.
3. **TypeScript client codegen** — `src/lib/codegen.ts` referenced in README/PLAN.md but not built.
4. **E2E smoke test** — POST /tools/scout against live URL with a real site. Browser Rendering may require CF Workers Paid plan.
5. **HttpApiSwagger** — PLAN.md Phase 1 mentions Swagger UI at `/docs`, not implemented. Current worker uses manual routing in `cf-worker.ts`.

### Known issues

- Browser Rendering requires a paid Cloudflare Workers plan
- CI `docs` and `deploy` jobs need 4 GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`, `ALCHEMY_STATE_TOKEN`
- Local `.alchemy/` directory has stale state from old `exedev` stage — can be deleted, production state lives in CloudflareStateStore
- PLAN.md Phases 8 (MCP) and 9 (LLM Agent) were descoped from initial ship

## Links

- Repo: https://github.com/acoyfellow/unsurf
- NPM: https://www.npmjs.com/package/unsurf
- Docs: https://unsurf.coey.dev
- Worker: https://unsurf.coy.workers.dev
