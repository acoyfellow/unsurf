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
- **Vitest** — 94 tests across 10 files
- **Astro Starlight** — docs site at https://unsurf.coey.dev

## Architecture

Every service is a `Context.Tag` with a live impl (CF bindings) and a test impl (in-memory).

```
src/
├── index.ts                  # NPM package barrel export
├── cf-worker.ts              # CF Worker entry point (routing, CORS, layer building)
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
- **Exports**: 45+ public symbols (tools, services, domain, MCP, AI agent, codegen)
- **Examples**: `examples/` directory with 7 runnable files importing from unsurf, tested by `test/examples.test.ts`
- **Build**: `bun run build` (tsup)
- **Prepublish**: `bun run prepublishOnly` → check + typecheck + test + build
- **Files included**: `dist/`, `src/` (excluding `cf-worker.ts`)
- **External deps**: effect, @effect/platform, @effect/schema, drizzle-orm, @cloudflare/puppeteer, @modelcontextprotocol/sdk, zod

## Live Deployment

- **Worker URL**: https://unsurf-api.coey.dev
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

**All phases complete (1-10).** 94 tests passing across 10 files. Worker deployed. NPM package published. MCP server live. AI agent built. Docs fully restructured (Diátaxis + agent-first). Self-hosted Google Sans Flex/Code fonts. 7 dogfooded examples with CI gate.

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
| Tests | ✅ | 94 passing, 10 files |
| Lint/Types | ✅ | Biome + tsc clean |
| NPM package | ✅ | tsup build, barrel export, 36 symbols |
| CF deploy | ✅ | https://unsurf-api.coey.dev |
| CI | ✅ | check → docs → deploy pipeline |
| Docs | ✅ | https://unsurf.coey.dev — 11 pages, Diátaxis, agent-first |
| NPM publish | ✅ | v0.1.0 live on npmjs.com |
| MCP server | ✅ | Streamable HTTP at /mcp, 3 tools (+ agent-scout with API key) |
| AI Scout Agent | ✅ | LlmProvider interface, Anthropic adapter, 4 tests |

### What remains (future)

1. ~~**MCP server**~~ — **Done.** Phase 8 complete. MCP Streamable HTTP at `/mcp` using `@modelcontextprotocol/sdk`. Stateless mode. All 3 tools registered with Zod input schemas.
2. ~~**LLM Scout Agent**~~ — **Done.** Phase 9 complete. `src/ai/ScoutAgent.ts` with `LlmProvider` interface + `AnthropicProvider`. MCP `agent-scout` tool when `ANTHROPIC_API_KEY` is set. 4 tests.
3. ~~**TypeScript client codegen**~~ — **Done.** `src/lib/codegen.ts` — `generateClient(spec)` → typed fetch client string.
4. ~~**Docs OG images + SEO**~~ — **Done.** Dynamic per-page OG images via sharp with embedded Google Sans Flex/Code TTF fonts (base64 in SVG). Custom Head component with twitter cards + JSON-LD.
5. ~~**Diátaxis docs restructure**~~ — **Done.** 11 pages across all 4 quadrants. 2 new agent-first pages (guides/agent-integration, concepts/agent-patterns). Config reference expanded from stub to full reference. Tutorial completes Scout→Worker→Heal→MCP loop.
6. ~~**Dogfooded examples**~~ — **Done.** 7 example files in `examples/` importing from unsurf, tested by `test/examples.test.ts` (15 tests). Docs embed examples via SourceCode component — if any export changes, build breaks.
7. ~~**Font branding**~~ — **Done.** Google Sans Flex (body) + Google Sans Code (mono). Self-hosted woff2 + TTF in `docs/public/fonts/`. No CDN dependency.
8. **E2E smoke test** — POST /tools/scout against live URL with a real site. Browser Rendering requires CF Workers Paid plan.
9. **HttpApiSwagger** — PLAN.md Phase 1 mentions Swagger UI at `/docs`, not implemented. Current worker uses manual routing in `cf-worker.ts`. Low priority — REST API is documented in reference/config.mdx.
10. **API Gallery** — Jan Wilmake (@janwilmake) suggested: a public GitHub repo or docs page that auto-updates with every API unsurf discovers. Living registry of "unsurfed" APIs with their OpenAPI specs. Think of it as a community-contributed catalog of unsurfed sites — each entry is a site URL, its OpenAPI spec (generated by scout), and metadata. Could be a JSON file in a repo, a searchable docs page, or even its own CF Worker. The key value: agents can search the gallery before scouting, reusing specs others already captured. Deduplication at the community level.

### Known issues

- Browser Rendering requires a paid Cloudflare Workers plan
- CI `docs` and `deploy` jobs need 4 GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`, `ALCHEMY_STATE_TOKEN`
- Local `.alchemy/` directory has stale state from old `exedev` stage — can be deleted, production state lives in CloudflareStateStore
- PLAN.md Phases 8 (MCP) and 9 (LLM Agent) were descoped from initial ship

## Links

- Repo: https://github.com/acoyfellow/unsurf
- NPM: https://www.npmjs.com/package/unsurf
- Docs: https://unsurf.coey.dev
- Worker: https://unsurf-api.coey.dev
