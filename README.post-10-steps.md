# unsurf

```
surf the web → unsurf it
```

Scout a website, get back a typed spec, run the spec against the live page, get back evidence it worked. Tools and gates share one schema.

![Directory](https://unsurf.coey.dev/directory-screenshot.png)

**[Browse the Directory →](https://unsurf.coey.dev/directory)**

---

## The spec

`proof-spec.v0.json` — three usage modes:

- **tool** — `act[]` only (click / fill / select / check / submit / read)
- **gate** — `observe[]` + `assert[]`. Includes `judgeScore` assertions running cloudeval's LLM-judge rubrics (Correctness, ToolUsage, Grounding, BehaviorPolicy, WorkflowReasoning, Factuality)
- **proof** — all three plus `loop`. Evidence bundle carries `usage` (tokens, cost, model) + `timings` (per-op wall-clock)

Types: [`@acoyfellow/proof-spec`](https://www.npmjs.com/package/@acoyfellow/proof-spec) — shared with [gateproof](https://gateproof.dev). Unsurf re-exports.

## The executor

```
observe → act → assert
```

[`src/services/Plan.ts`](./src/services/Plan.ts):

- `runSpec(spec, args)` — auto-picks based on spec shape, returns `EvidenceBundle`
- `invokeSpec(spec, args)` — runs `act[]`
- `verifySpec(spec)` — runs `observe` + `assert` only
- `runLoopSpec(spec, args)` — honors `spec.loop.maxIterations` (clamped to 1 for `risk: high`)

`risk` is computed from `act[]` by [`RiskLabeler`](./src/services/RiskLabeler.ts), never from the synthesizer. Adversarial pages can't downgrade it.

Vitest matchers: `import { expectSpec } from "unsurf/testing"` → `.toPass()`, `.toHaveAssertion(...)`, `.toObserveDomElement(...)`.

## Auth

The agent runs inside your authenticated tab. Your cookies, your localStorage, your credentialed fetches. Sign in once; the agent is you until you close the tab.

## The Directory

URL-keyed registry of scouted specs, fingerprinted by page structure. Two tiers:

- **Local** — `.unsurf/directory/` per-repo. Record once, replay forever in tests.
- **Hosted** — `unsurf-api.coey.dev/d/`. Publish on opt-in.

```
GET  /d/                            # all catalogs
GET  /d/:domain                     # per-domain view
GET  /d/catalog/:fingerprint        # one catalog
POST /d/catalog                     # publish
```

Agents read from local first, fall back to hosted on miss, synth on double-miss.

---

## Use it

### As a library

```bash
bun add unsurf
```

```ts
// API capture (original): OpenAPI from network traffic
import { scout, worker, heal } from "unsurf";

// proof-spec executor
import { runSpec, verifySpec, type ProofSpec } from "unsurf";
const result = await runSpec(spec, { email: "jane@example.com" });

// Effect service
import { Plan, PlanLive } from "unsurf";

// Vitest matchers
import { expectSpec } from "unsurf/testing";
expect(result).toPass();
```

### As a CLI

```bash
bunx unsurf scout https://example.com/contact
# → writes proof-spec.v0.json to stdout

bunx unsurf run ./spec.json --args '{"email":"jane@example.com"}'
# → runs the spec, prints EvidenceBundle, exits 0 on pass
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

```
examples/webmcp-extension/   # Chrome MV3, ~200 lines
```

Install the extension + @mcp-b local relay. Tools appear in your MCP client, run in your tab, as you.

### As a daemon (no extension)

```bash
bunx unsurf-daemon
```

For managed Chromes that block extensions (`ExtensionInstallBlocklist`), attach via CDP instead.

```
examples/webmcp-daemon/      # Bun daemon, CDP-injected, ~450 lines
```

### As a filepath harness

```
examples/filepath-harness-shim/
```

Agents inside a [filepath](https://myfilepath.com) workspace shell out to `bunx unsurf` like any other tool.

### As a lab capability

```ts
import { spec } from "./contact-form.json";
const receipt = await lab.runProofSpec(spec, { email });
// canonical JSON at lab.coey.dev/results/:id.json
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

---

## Stack

Runs on Cloudflare primitives:

- **Workers** — runtime
- **Workers AI** — synthesis (Qwen 2.5 Coder 32B)
- **Browser Rendering** — scout
- **D1 + R2** — Directory storage
- **MCP endpoint** — `unsurf-api.coey.dev/mcp`

Adjacent tools sharing `proof-spec.v0`:

- [gateproof](https://gateproof.dev) — HTTP + exec altitude
- [cloudeval](https://github.com/acoyfellow/cloudeval) — LLM-judge rubrics
- [lab](https://lab.coey.dev) — capability sandbox + canonical receipts
- [filepath](https://myfilepath.com) — agent runtime (unsurf available as a harness)

## Built with

- [Effect](https://effect.website) — typed errors, streams, DI
- [Alchemy](https://alchemy.run) — infra as TypeScript
- [Drizzle](https://orm.drizzle.team) — D1 schemas
- [@acoyfellow/proof-spec](https://www.npmjs.com/package/@acoyfellow/proof-spec) — shared schema
- [@mcp-b](https://docs.mcp-b.ai) — WebMCP polyfill + local relay
- [MCP SDK](https://modelcontextprotocol.io) — client + transports

## Why Effect

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

- **API capture + replay** via `scout / worker / heal`
- **DOM capture** via `scout-dom` — Workers AI synthesizes `act[]` + `assert[]` from any URL
- **CLI** — `bunx unsurf scout` / `bunx unsurf run`
- **Extension** — Chrome MV3, inherits your session
- **Daemon** — CDP-attached, works against managed Chromes
- **filepath harness** — drop-in tool inside filepath workspaces
- **lab capability** — `lab.runProofSpec(spec)` ships canonical receipts
- **Directory** — two-tier (local VCR cache + hosted public), dual-type (API + WebMCP)
- **Evidence bundles** carry `usage` + `timings`

Receipts + benchmarks: [`experiments/SUMMARY.md`](./experiments/SUMMARY.md).

## License

MIT
