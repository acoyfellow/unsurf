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

Phases 1–9 complete. **Phase 10 partially complete** — CI deploy pipeline and docs updates are done; actual deploy blocked on Cloudflare credentials.

**75 tests passing** across 8 test files. Typecheck, lint, and tests all green.

All three MCP tools (Scout, Worker, Heal) are implemented and wired to the Worker entry point at `src/index.ts`. The Worker routes POST requests to `/tools/scout`, `/tools/worker`, `/tools/heal` and builds Effect layers from CF bindings per-request.

### Phase 10 progress

| Task | Status | Notes |
|---|---|---|
| Deploy API worker | 🔲 Blocked | Needs `CLOUDFLARE_API_TOKEN` or `alchemy login` — no CF credentials on build VM |
| CI deploy job | ✅ Done | `deploy` job in `.github/workflows/ci.yml`, runs after `check`, main only. Needs 3 GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD` |
| Smoke test | ⏳ Pending | CI deploy job has a smoke test step. Set `WORKER_URL` repo variable once deployed. |
| Docs URL updates | ✅ Done | Replaced hardcoded `your-unsurf-url.workers.dev` with `$UNSURF_URL` shell variable pattern across all guides and tutorial |
| Update dear_llm.md | ✅ Done | This file |

### To deploy (manual steps for repo owner)

1. Set GitHub repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ALCHEMY_PASSWORD`
2. Push to `main` — CI will run `check` → `deploy`
3. Or deploy locally: `CLOUDFLARE_API_TOKEN=xxx ALCHEMY_PASSWORD=xxx bun run deploy`
4. Once deployed, set `WORKER_URL` as a GitHub repo variable for the CI smoke test
5. Update docs `$UNSURF_URL` examples with the real URL if desired

### What remains (future)

1. **MCP server** — Not yet implemented. The README mentions MCP but the current API is plain HTTP POST. Adding an MCP transport layer (stdio or SSE) is a future enhancement.
2. **TypeScript client codegen** — `src/lib/codegen.ts` referenced in README but not built. Future.
3. **LLM-guided scout** — `src/ai/` not built. Future enhancement where an LLM decides what to click/fill during scouting.

### Known issues
- CI `docs` job may fail if Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) aren't set in GitHub repo settings
- `alchemy.run.ts` uses `"dev-password"` fallback — must set real `ALCHEMY_PASSWORD` for production
- Browser Rendering requires a paid Cloudflare Workers plan

## Links

- Repo: https://github.com/acoyfellow/unsurf
- Docs: https://unsurf.coey.dev
