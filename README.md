# unsurf

Turn any website into a typed API.

```
surf the web → unsurf it
```

## What it does

An agent visits a site, captures every API call happening under the hood, and gives you back:

- **OpenAPI spec** — every endpoint, typed
- **TypeScript client** — ready to import
- **Execution paths** — step-by-step recipes to repeat actions

No reverse engineering. No docs. No browser needed after the first pass.

## How it works

```
Agent                     unsurf                        Target Site
  │                          │                               │
  │  scout(url, task)        │                               │
  │─────────────────────────▶│                               │
  │                          │  browser + network capture    │
  │                          │──────────────────────────────▶│
  │                          │◀──────────────────────────────│
  │                          │                               │
  │  { openapi, client,      │                               │
  │    paths, endpoints }    │                               │
  │◀─────────────────────────│                               │
  │                          │                               │
  │  worker(path, data)      │  replay API directly          │
  │─────────────────────────▶│──────────────────────────────▶│
  │  { result }              │◀──────────────────────────────│
  │◀─────────────────────────│                               │
```

**Scout** explores. **Worker** executes. **Heal** fixes things when they break.

## Quick start

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/unsurf)

Or manually:

```bash
git clone https://github.com/acoyfellow/unsurf
cd unsurf
bun install
bun run dev
```

## MCP Tools

### `scout`

Explore a site. Map its API.

```json
{
  "tool": "scout",
  "input": {
    "url": "https://example.com",
    "task": "find the contact form and map how it submits"
  }
}
```

Returns captured endpoints with inferred schemas, an OpenAPI spec, and replayable paths.

### `worker`

Execute a scouted path. Skips the browser — replays the API calls directly.

```json
{
  "tool": "worker",
  "input": {
    "path_id": "example-com-contact-form",
    "data": {
      "name": "Jane Doe",
      "email": "jane@example.com",
      "message": "Hello"
    }
  }
}
```

### `heal`

Site changed? Path broken? Heal re-scouts, diffs, patches, retries.

```json
{
  "tool": "heal",
  "input": {
    "path_id": "example-com-contact-form",
    "error": "Form field 'email' not found"
  }
}
```

## Built with

- [Effect](https://effect.website) — typed errors, dependency injection, streams, retries
- [Alchemy](https://alchemy.run) — infrastructure as TypeScript (replaces wrangler.toml)
- [Drizzle](https://orm.drizzle.team) — typed SQL schemas and queries
- [Cloudflare Workers](https://workers.cloudflare.com) — edge runtime
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) — headless browser
- [D1](https://developers.cloudflare.com/d1/) + [R2](https://developers.cloudflare.com/r2/) — storage

## Why Effect

Every operation in unsurf can fail. Browsers crash. Sites change. Networks drop. APIs rate-limit.

| Problem | Effect solution |
|---|---|
| Browser container leaks | `Scope` + `acquireRelease` — guaranteed cleanup |
| Transient failures | `Schedule.exponential` + `retry` — automatic backoff |
| Different error types need different handling | `Schema.TaggedError` + `catchTag` — typed error routing |
| Swapping browser/store in tests | `Layer` + `Context.Tag` — inject different implementations |
| Hundreds of CDP network events | `Stream` — filter, group, process without buffering |
| LLM provider outages | `ExecutionPlan` — OpenAI → Anthropic fallback |
| Data validation + OpenAPI generation | `Schema` — one definition, five outputs |

## Architecture

```
unsurf/
├── alchemy.run.ts                # Infrastructure as code (D1, R2, Worker, Browser)
├── src/
│   ├── index.ts                  # Worker entry point
│   ├── Api.ts                    # HttpApi definition
│   ├── ApiLive.ts                # HttpApiBuilder implementation
│   ├── domain/                   # Effect Schema definitions
│   │   ├── Endpoint.ts           # CapturedEndpoint
│   │   ├── Path.ts               # ScoutedPath + PathStep
│   │   ├── NetworkEvent.ts       # CDP event schema
│   │   ├── Errors.ts             # Tagged errors
│   │   └── Site.ts               # Site metadata
│   ├── db/                       # Drizzle schema + queries
│   │   ├── schema.ts             # Drizzle table definitions
│   │   └── queries.ts            # Typed query helpers
│   ├── services/                 # Effect services
│   │   ├── Browser.ts            # CF browser rendering
│   │   ├── Store.ts              # D1 (via Drizzle) + R2
│   │   ├── SchemaInferrer.ts     # JSON → Schema
│   │   └── OpenApiGenerator.ts   # Endpoints → OpenAPI
│   ├── tools/                    # MCP tool implementations
│   │   ├── Scout.ts
│   │   ├── Worker.ts
│   │   └── Heal.ts
│   ├── ai/                       # LLM scout agent (planned)
│   └── lib/                      # Utilities
│       └── url.ts                # URL pattern normalization
├── migrations/                   # Drizzle-generated SQL migrations
├── drizzle.config.ts
├── test/
├── package.json
└── tsconfig.json
```

## Infrastructure

No YAML. No TOML. Just TypeScript.

```typescript
// alchemy.run.ts
import alchemy from "alchemy"
import { Worker, D1Database, Bucket, BrowserRendering } from "alchemy/cloudflare"

const app = await alchemy("unsurf", {
  password: process.env.ALCHEMY_PASSWORD,
})

const DB = await D1Database("unsurf-db", {
  migrationsDir: "./migrations",
})

const STORAGE = await Bucket("unsurf-storage")

const BROWSER = BrowserRendering()

export const WORKER = await Worker("unsurf", {
  entrypoint: "./src/index.ts",
  bindings: { DB, STORAGE, BROWSER },
  url: true,
})

await app.finalize()
```

## Self-hosted

Deploy to your own Cloudflare account. Your data stays yours.

```bash
bun run deploy
```

## License

MIT
