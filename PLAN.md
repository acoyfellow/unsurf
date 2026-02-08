# unsurf — Implementation Plan

## Summary

Turn any website into a typed API. Scout captures network traffic via CDP, infers schemas, outputs OpenAPI + TypeScript client. Worker replays captured endpoints directly. Heal re-scouts when paths break.

Effect is the runtime. Alchemy is the infra. Drizzle is the database layer. Bun is the package manager and runtime.

---

## Phase 1: Skeleton (Day 1)

**Goal:** Deployable CF Worker with Effect runtime, HttpApi serving 3 stub endpoints, D1 via Drizzle, R2, Browser Rendering binding, Swagger UI at `/docs`.

### Tasks

1. **Init project**
   - `bun init` + `bun add effect @effect/platform @effect/schema @effect/sql-drizzle @effect/sql-d1 drizzle-orm alchemy`
   - `bun add -d drizzle-kit @effect/vitest vitest typescript`
   - `tsconfig.json` (strict, exactOptionalPropertyTypes)

2. **Alchemy config** (`alchemy.run.ts`)
   ```typescript
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

3. **Drizzle schema** (`src/db/schema.ts`)
   ```typescript
   import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

   export const sites = sqliteTable("sites", {
     id: text("id").primaryKey(),
     url: text("url").notNull(),
     domain: text("domain").notNull(),
     firstScoutedAt: text("first_scouted_at").notNull(),
     lastScoutedAt: text("last_scouted_at").notNull(),
   })

   export const endpoints = sqliteTable("endpoints", {
     id: text("id").primaryKey(),
     siteId: text("site_id").notNull().references(() => sites.id),
     method: text("method").notNull(), // GET, POST, etc.
     pathPattern: text("path_pattern").notNull(),
     requestSchema: text("request_schema"),   // JSON Schema as JSON string
     responseSchema: text("response_schema"),  // JSON Schema as JSON string
     requestHeaders: text("request_headers"),   // JSON string
     responseHeaders: text("response_headers"), // JSON string
     sampleCount: integer("sample_count").notNull().default(1),
     firstSeenAt: text("first_seen_at").notNull(),
     lastSeenAt: text("last_seen_at").notNull(),
   })

   export const paths = sqliteTable("paths", {
     id: text("id").primaryKey(),
     siteId: text("site_id").notNull().references(() => sites.id),
     task: text("task").notNull(),
     steps: text("steps").notNull().default("[]"),         // JSON array
     endpointIds: text("endpoint_ids").notNull().default("[]"), // JSON array
     status: text("status").notNull().default("active"),    // active | broken | healing
     createdAt: text("created_at").notNull(),
     lastUsedAt: text("last_used_at"),
     failCount: integer("fail_count").notNull().default(0),
     healCount: integer("heal_count").notNull().default(0),
   })

   export const runs = sqliteTable("runs", {
     id: text("id").primaryKey(),
     pathId: text("path_id").references(() => paths.id),
     tool: text("tool").notNull(),    // scout | worker | heal
     status: text("status").notNull(), // running | success | error
     input: text("input").notNull(),   // JSON
     output: text("output"),           // JSON
     error: text("error"),             // JSON
     durationMs: integer("duration_ms"),
     harKey: text("har_key"),          // R2 key
     createdAt: text("created_at").notNull(),
   })
   ```

4. **Drizzle config** (`drizzle.config.ts`)
   ```typescript
   import type { Config } from "drizzle-kit"

   export default {
     schema: "./src/db/schema.ts",
     out: "./migrations",
     dialect: "sqlite",
   } satisfies Config
   ```

5. **Domain schemas** (`src/domain/`)
   - `Errors.ts` — `NetworkError`, `BrowserError`, `PathBrokenError`, `StoreError`, `NotFoundError` as `Schema.TaggedError`
   - `Endpoint.ts` — `CapturedEndpoint` Effect Schema (mirrors Drizzle shape, used for API validation)
   - `Path.ts` — `ScoutedPath` + `PathStep` Effect Schemas
   - `Site.ts` — `Site` Effect Schema
   - `NetworkEvent.ts` — `NetworkEvent` Effect Schema (CDP events)

6. **Service tags** (`src/services/`)
   - `Browser.ts` — `Context.Tag("Browser")` with: `navigate`, `captureNetwork`, `screenshot`, `evaluate`, `close`
   - `Store.ts` — `Context.Tag("Store")` with: `saveSite`, `getSite`, `saveEndpoints`, `getEndpoints`, `savePath`, `getPath`, `listPaths`, `saveRun`, `saveBlob`
   - Stub `Layer` implementations returning `Effect.succeed` with empty data

7. **HttpApi definition** (`src/Api.ts`)
   - `ScoutEndpoint` — POST `/tools/scout` with `{ url, task, auth? }` payload
   - `WorkerEndpoint` — POST `/tools/worker` with `{ pathId, data? }` payload
   - `HealEndpoint` — POST `/tools/heal` with `{ pathId, error? }` payload
   - `ListEndpointsEndpoint` — GET `/sites/:siteId/endpoints`
   - `GetSpecEndpoint` — GET `/sites/:siteId/openapi`

8. **HttpApiBuilder** (`src/ApiLive.ts`) + **HttpApiSwagger** at `/docs`

9. **Worker entry** (`src/index.ts`) — compose all layers, launch server

10. **package.json scripts**
    ```json
    {
      "scripts": {
        "dev": "bun run alchemy.run.ts",
        "deploy": "bun run alchemy.run.ts",
        "generate": "bunx drizzle-kit generate",
        "migrate": "bunx drizzle-kit migrate",
        "studio": "bunx drizzle-kit studio",
        "test": "bun vitest"
      }
    }
    ```

### Effect concepts used
- `Schema.Class`, `Schema.TaggedError`
- `Context.Tag`, `Layer.succeed`
- `HttpApi`, `HttpApiEndpoint`, `HttpApiGroup`, `HttpApiBuilder`, `HttpApiSwagger`

### Exit criteria
- `bun run dev` launches Worker via Alchemy
- Swagger UI at `/docs`
- All 5 endpoints return stub responses
- Drizzle migration generated and applied to D1
- Tests run with stub layers

---

## Phase 2: Store (Day 2)

**Goal:** Real D1 (via Drizzle) + R2 Store implementation. All queries typed.

### Tasks

1. **Drizzle query helpers** (`src/db/queries.ts`)
   - Typed insert/select/update/delete for each table
   - Use `drizzle-orm` query builder — no raw SQL
   - Example:
     ```typescript
     import { eq } from "drizzle-orm"
     import { drizzle } from "drizzle-orm/d1"
     import * as schema from "./schema"

     export const createDb = (d1: D1Database) => drizzle(d1, { schema })
     export type Db = ReturnType<typeof createDb>

     export const getSite = (db: Db, id: string) =>
       db.select().from(schema.sites).where(eq(schema.sites.id, id)).get()

     export const saveSite = (db: Db, site: typeof schema.sites.$inferInsert) =>
       db.insert(schema.sites).values(site).onConflictDoUpdate({
         target: schema.sites.id,
         set: { lastScoutedAt: site.lastScoutedAt },
       })
     ```

2. **Store.D1Live** (`src/services/Store.ts`)
   - Accept D1 binding + R2 binding from Worker env
   - Initialize Drizzle with `drizzle(env.DB, { schema })`
   - All operations use typed Drizzle queries
   - Blob storage via `env.STORAGE.put()` / `env.STORAGE.get()`
   - Wrap in `Effect.tryPromise` → `StoreError`

3. **Store.TestLive** (`test/layers/TestStore.ts`)
   - In-memory Map-based implementation
   - Same interface, zero IO

4. **Store tests** (`test/Store.test.ts`)
   - CRUD round-trip tests using `@effect/vitest` + `it.effect()`

### Effect concepts used
- `Layer.effect` with `Effect.gen` for async construction
- `Effect.tryPromise` with error mapping
- `@effect/vitest` for testing

### Exit criteria
- Typed Drizzle queries for all tables
- Save + retrieve sites, endpoints, paths, runs
- Blobs stored in R2
- Tests pass

---

## Phase 3: Browser + Network Capture (Day 3)

**Goal:** Launch CF Browser Rendering session, navigate, capture CDP network events as an Effect `Stream`.

### Tasks

1. **Browser.Live** (`src/services/Browser.ts`)
   - `Layer.scoped` with `Effect.acquireRelease`:
     - Acquire: `puppeteer.connect(env.BROWSER)` → open page
     - Release: `browser.close()` via `Effect.orDie`
   - `navigate(url)` — wrapped in `Effect.tryPromise` → `BrowserError`
   - `captureNetwork()` — CDP `Network.enable`, `Stream.async` emitting `NetworkEvent` per request/response pair
   - `screenshot()` — `page.screenshot()` → `Uint8Array`
   - `evaluate(fn)` — `page.evaluate(fn)` wrapped in Effect

2. **Network event correlation**
   - Match `requestWillBeSent` with `responseReceived` by requestId
   - Capture response body from `Network.getResponseBody`
   - Emit complete `NetworkEvent` only when both sides present

3. **Browser.TestLive** (`test/layers/TestBrowser.ts`)
   - Replays pre-recorded `NetworkEvent[]` from JSON fixture
   - No real browser needed

### Effect concepts used
- `Layer.scoped` + `Effect.acquireRelease` — browser lifecycle
- `Stream.async` — CDP events → Effect Stream
- `Scope` — guaranteed cleanup

### Exit criteria
- Browser launches, navigates, captures XHR/fetch events
- Events emitted as `Stream<NetworkEvent>`
- Browser always closes, even on error

---

## Phase 4: Schema Inferrer (Day 4)

**Goal:** Infer JSON Schema from response samples. Normalize URL patterns. Merge schemas.

### Tasks

1. **SchemaInferrer service** (`src/services/SchemaInferrer.ts`)
   - `infer(samples: unknown[])` → JSON Schema
     - Detect types, optionality, formats (email, url, date-time, uuid)
   - `merge(a, b)` → widened JSON Schema

2. **URL pattern normalization** (`src/lib/url.ts`)
   - `/contacts/abc123` → `/contacts/:id`
   - Group UUIDs, numeric IDs, base64 segments

3. **Tests** for inference, normalization, merging

### Exit criteria
- JSON Schema inferred from sample arrays
- URL patterns normalized
- Schemas merge correctly

---

## Phase 5: Scout (Day 5-6)

**Goal:** Full scout pipeline — browse, capture, infer, save, return OpenAPI spec.

### Tasks

1. **Scout tool** (`src/tools/Scout.ts`)
   ```
   scout(url, task) =
     Effect.scoped(
       Browser.navigate(url)
       → Browser.captureNetwork()
       → Stream.filter(xhr/fetch)
       → Stream.groupByKey(normalizeUrl)
       → SchemaInferrer.infer(per group)
       → Store.saveSite + Store.saveEndpoints  [Drizzle]
       → OpenApiGenerator.generate(endpoints)
       → Store.saveBlob(har, screenshots)       [R2]
       → Store.savePath(steps)                  [Drizzle]
       → return { endpoints, openApiSpec, paths }
     )
   ```

2. **OpenApiGenerator** (`src/services/OpenApiGenerator.ts`)
   - `CapturedEndpoint[]` → OpenAPI 3.1 JSON
   - Inferred schemas → `components/schemas`

3. **v1 navigation: simple** — navigate to URL, wait for network idle, capture

4. **Wire into ApiLive**

### Exit criteria
- `POST /tools/scout { url: "https://jsonplaceholder.typicode.com" }` returns:
  - Captured endpoints, valid OpenAPI 3.1, inferred response schemas
  - Path saved to D1 via Drizzle
  - HAR + screenshot saved to R2

---

## Phase 6: Worker (Day 7)

**Goal:** Execute scouted paths. Fast path = API replay. Slow path = browser.

### Tasks

1. **Worker tool** (`src/tools/Worker.ts`)
   - Load path from Drizzle
   - Fast path: `HttpClient.request` to replay captured endpoint
   - Slow path: `Effect.scoped` browser execution

2. **API replay** (`src/lib/replay.ts`)
   - Build request from `CapturedEndpoint`
   - Merge user data into body/query
   - Validate response against stored schema

### Exit criteria
- Worker replays API endpoint without browser (< 500ms)
- Falls back to browser when no API endpoint exists

---

## Phase 7: Heal (Day 8)

**Goal:** Retry with backoff, then re-scout and patch.

### Tasks

1. **Heal tool** (`src/tools/Heal.ts`)
   - `Effect.retry` with `Schedule.exponential("200ms", 2)` + `Schedule.recurs(3)`
   - `Effect.catchTag("PathBrokenError")` → re-scout → diff → update path in Drizzle → retry

### Exit criteria
- Transient errors retried with backoff
- Permanent failures trigger re-scout + path update

---

## Phase 8: MCP Protocol (Day 9)

**Goal:** Proper MCP server alongside REST API.

### Tasks

1. MCP transport (SSE or stdio)
2. `tools/list` returns scout, worker, heal with JSON Schema
3. `tools/call` routes to handlers
4. REST endpoints still work

### Exit criteria
- Claude Desktop / Cursor can connect as MCP server

---

## Phase 9: LLM Scout Agent (Day 10)

**Goal:** LLM-driven exploration via `@effect/ai`.

### Tasks

1. **Scout toolkit** (`src/ai/ScoutAgent.ts`)
   - Tools: `NavigateTo`, `ClickElement`, `FillForm`, `ReadPage`, `SubmitForm`
   - `Toolkit.toLayer` wrapping `BrowserService` methods

2. **ExecutionPlan**
   - Primary: OpenAI gpt-4o (3 attempts)
   - Fallback: Anthropic claude-4-sonnet (2 attempts)

3. LLM navigates autonomously while CDP captures

### Exit criteria
- LLM explores multi-page site
- Finds forms, buttons, API calls
- Falls back across providers

---

## Phase 10: Polish + Ship (Day 11-12)

### Tasks

1. **TS client codegen** (`src/lib/codegen.ts`) — OpenAPI → typed fetch client
2. **Deploy button** — verify one-click Alchemy deploy
3. **Marketing site** at `unsurf.coey.dev`
4. **GitHub repo** at `github.com/acoyfellow/unsurf`
5. **GitHub Actions** — `bun test` on PR

---

## Layer Dependency Graph

```
ServerLive
└── ApiLive
    ├── ToolsLive
    │   ├── Scout.Live
    │   │   ├── Browser.Live        [CF Browser Rendering, scoped]
    │   │   ├── Store.D1Live       [Drizzle + R2, shared]
    │   │   ├── SchemaInferrer.Live [pure computation]
    │   │   ├── OpenApiGenerator.Live [pure computation]
    │   │   └── ScoutAgent.Live    [Phase 9, optional]
    │   │       └── LanguageModel  [@effect/ai]
    │   │           ├── OpenAiClient.Live
    │   │           └── AnthropicClient.Live
    │   ├── Worker.Live
    │   │   ├── Store.D1Live       [shared, memoized]
    │   │   ├── Browser.Live       [only if needed, scoped]
    │   │   └── HttpClient.Live    [API replay]
    │   └── Heal.Live
    │       ├── Scout.Live         [re-scout]
    │       ├── Worker.Live        [re-execute]
    │       └── Store.D1Live       [shared, memoized]
    └── HttpApiSwagger.layer   [auto /docs]
```

### Test Layer Swap

```
ServerTest
└── ApiLive
    └── ToolsLive
        ├── Browser.TestLive       [replays fixtures]
        ├── Store.TestLive         [in-memory Map]
        ├── SchemaInferrer.Live    [same — pure]
        └── OpenApiGenerator.Live  [same — pure]
```

Business logic unchanged. Only infra layers swap.

---

## Two Schema Systems — How They Relate

**Drizzle** owns the database. Defines tables, generates migrations, runs typed queries.

**Effect Schema** owns the API boundary. Defines request/response shapes, validates data, generates OpenAPI specs, types the error channel.

They meet in the Store service:

```typescript
// Store.D1Live bridges the two
const saveSite = (site: Site) =>  // Site = Effect Schema type
  Effect.tryPromise({
    try: () => db.insert(schema.sites).values({  // schema.sites = Drizzle table
      id: site.id,
      url: site.url,
      domain: site.domain,
      firstScoutedAt: site.firstScoutedAt,
      lastScoutedAt: site.lastScoutedAt,
    }).run(),
    catch: (e) => new StoreError({ message: String(e) }),
  })

const getSite = (id: string) =>
  Effect.tryPromise({
    try: () => db.select().from(schema.sites).where(eq(schema.sites.id, id)).get(),
    catch: (e) => new StoreError({ message: String(e) }),
  }).pipe(
    Effect.flatMap((row) =>
      row ? Effect.succeed(row) : Effect.fail(new NotFoundError({ id }))
    )
  )
```

Drizzle types (`$inferSelect`, `$inferInsert`) stay inside the Store layer. Effect Schema types face outward to the API and tools.

---

## Package Dependencies

```json
{
  "dependencies": {
    "effect": "^3.19.16",
    "@effect/platform": "^0.94.3",
    "@effect/schema": "^0.75.5",
    "@effect/ai": "^0.33.2",
    "@effect/ai-openai": "^0.37.2",
    "@effect/sql-d1": "^0.47.0",
    "@effect/sql-drizzle": "^0.48.0",
    "drizzle-orm": "latest",
    "@cloudflare/puppeteer": "latest"
  },
  "devDependencies": {
    "alchemy": "^0.77.5",
    "drizzle-kit": "latest",
    "@effect/vitest": "latest",
    "vitest": "latest",
    "typescript": "^5.9.3"
  }
}
```

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| CF Browser Rendering availability | TestBrowser layer; test suite runs without real browser |
| Effect on CF Workers bundle size | Tree-shake; Effect is ESM-native |
| Schema inference accuracy | Start simple, improve iteratively; raw samples in R2 |
| LLM scout unreliable | Phase 9 optional; v1 scout is deterministic |
| Drizzle + D1 edge cases | Use `@effect/sql-d1` as escape hatch for raw queries |

---

## Success Metrics

1. **Scout jsonplaceholder.typicode.com** → valid OpenAPI spec with all endpoints typed
2. **Worker replays** a captured endpoint without browser (< 500ms)
3. **Heal recovers** from a simulated path break
4. **One-click deploy** via Alchemy → working unsurf in < 2 minutes
5. **jordancoeyman.com contact form** — scout finds it, worker submits it
