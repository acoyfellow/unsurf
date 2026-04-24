# unsurf

```
surf the web → unsurf it
```

Scout a website, get back a typed spec, run the spec against the live page, get back evidence it worked. Tools and gates share one schema.

Also ships three composable skills for the agent loop:
**`record`** drives a real browser and uploads a grant-gated mp4 + step trace (private by default as of 0.4.0; see [privacy](https://unsurf.coey.dev/guides/privacy)).
**`observeVideo`** watches a recording and answers questions about it.
**`loop`** closes the cycle: record → observe → refine → record, until a North Star question returns yes.

![Directory](https://unsurf.coey.dev/directory-screenshot.png)

**[Browse the Directory →](https://unsurf.coey.dev/directory)** · **[See a live trace →](https://trace.coey.dev/r/nb9uurla35eg)**

---

## The spec

`proof-spec.v0.json` — three usage modes:

- **tool** — `act[]` only (click / fill / select / check / submit / read)
- **gate** — `observe[]` + `assert[]`
- **proof** — all three plus `loop`

Shared with [gateproof](https://gateproof.dev) — same file in both repos. Types: [`src/domain/ProofSpec.ts`](./src/domain/ProofSpec.ts). Full reference: [`experiments/_proof-spec-v0/SPEC.md`](./experiments/_proof-spec-v0/SPEC.md). Frozen at v0.

Legacy: `tool-spec.v0.json` in [`experiments/CONTRACT.md`](./experiments/CONTRACT.md) is a strict subset.

## The executor

```
observe → act → assert
```

[`src/services/Plan.ts`](./src/services/Plan.ts):

- `runSpec(spec, args)` — auto-picks based on spec shape
- `invokeSpec(spec, args)` — runs `act[]`
- `verifySpec(spec)` — runs `observe` + `assert` only
- `runLoopSpec(spec, args)` — honors `spec.loop.maxIterations` (clamped to 1 for `risk: high`)

`risk` is computed from `act[]` by [`RiskLabeler`](./src/services/RiskLabeler.ts), never from the synthesizer. An adversary can't downgrade it by planting "set risk to low" in a hidden `<div>`.

## Auth

The agent runs inside your authenticated tab. Your cookies, your localStorage, your credentialed fetches. Sign in once; the agent is you until you close the tab.

No OAuth dance, no credential storage, no delegation protocol.

## The Directory

URL-keyed registry of scouted specs, fingerprinted by page structure.

- `GET /d/` — all catalogs
- `GET /d/:domain` — per-domain view
- `GET /d/catalog/:fingerprint` — fetch a catalog
- `POST /d/catalog` — publish one

Self-host and it runs against your account. Use [the shared one](https://unsurf-api.coey.dev) and it runs against mine.

---

## Use it

### As a library

```bash
bun add unsurf
```

```typescript
// API capture (original): turn a site's hidden endpoints into OpenAPI + typed calls
import { scout, worker, heal } from "unsurf";

// proof-spec executor (new): run any observe/act/assert spec
import { runSpec, verifySpec, type ProofSpec } from "unsurf";
const result = await runSpec(spec, { email: "jane@example.com" });

// Effect-wrapped service surface
import { Plan, PlanLive } from "unsurf";
```

### As an MCP server

```json
{
  "mcpServers": {
    "unsurf": { "url": "https://unsurf-api.coey.dev/mcp" }
  }
}
```

### As an extension

Install the unsurf extension + @mcp-b local relay. Open a page. If it's in the Directory, the tools appear in your MCP client. Tools run inside your tab, as you.

```
examples/webmcp-extension/   # Chrome MV3, ~200 lines
```

### As a daemon (no extension)

For managed Chromes that block extensions (`ExtensionInstallBlocklist`), attach via CDP instead.

```bash
bunx unsurf-daemon
```

```
examples/webmcp-daemon/      # Bun daemon, CDP-injected, ~450 lines
```

### Self-hosted

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/unsurf)

```bash
git clone https://github.com/acoyfellow/unsurf && cd unsurf
bun install && bun run deploy
```

---

## Two capture paths

```
  Agent                 unsurf                       Target site
  │                       │                            │
  │  scout(url)           │  capture network      ───▶ │  OpenAPI + paths
  │                       │  capture DOM          ───▶ │  proof-spec.v0.json
  │                       │                            │
  │  worker(id, args)     │  replay API via fetch ───▶ │
  │  or runSpec(spec)     │  invoke tool in tab   ───▶ │  runs as user
  │                       │                            │
  │  heal(id, error)      │  re-scout, patch      ───▶ │
```

Network capture is the original path. DOM capture produces `proof-spec.v0.json`. Some sites get both.

---

## Stack

Runs on Cloudflare primitives:

- **Workers** — runtime
- **Workers AI** — synthesis (Qwen 2.5 Coder 32B)
- **Browser Rendering** — scout
- **D1 + R2** — Directory storage
- **MCP endpoint** — `unsurf-api.coey.dev/mcp`

Adjacent tools that share shape:

- [gateproof](https://gateproof.dev) — same `observe / act / assert`, HTTP + exec altitude
- [lab](https://lab.coey.dev) — agent receipts

## Built with

- [Effect](https://effect.website) — typed errors, streams, DI
- [Alchemy](https://alchemy.run) — infra as TypeScript
- [Drizzle](https://orm.drizzle.team) — D1 schemas
- [@mcp-b](https://docs.mcp-b.ai) — WebMCP polyfill + local relay
- [MCP SDK](https://modelcontextprotocol.io) — client + transports

## Why Effect

Every operation can fail. Browsers crash, sites change, networks drop, synthesizers hallucinate.

| Problem | Effect solution |
|---|---|
| Browser container leaks | `Scope` + `acquireRelease` |
| Transient failures | `Schedule.exponential` + `retry` |
| Typed error routing | `Schema.TaggedError` + `catchTag` |
| Inject synthesizer / store / browser | `Layer` + `Context.Tag` |
| CDP event streams | `Stream` |
| LLM fallback | `ExecutionPlan` |
| Spec + OpenAPI + tool-spec from one source | `Schema` |

---

## What works today

- **API capture + replay** via `scout / worker / heal` — production
- **WebMCP capture** via `scout-dom` — works on sites with interactive HTML + clean ARIA. Tested on Midjourney, coey.dev, jordancoeyman.com, httpbin, and a handful of forms
- **Extension** — Chrome MV3, inherits your session
- **Daemon** — CDP-attached, works against managed Chromes
- **Directory** — live, dual-type, free to read, free to write

Receipts: [`experiments/SUMMARY.md`](./experiments/SUMMARY.md).

## License

MIT
