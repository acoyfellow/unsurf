# unsurf

```
surf the web → unsurf it
```

A spec, a verification loop, an auth invariant, a directory. Everything else is liquid.

![Directory](https://unsurf.coey.dev/directory-screenshot.png)

**[Browse the Directory →](https://unsurf.coey.dev/directory)**

---

## The solid parts

These four are load-bearing. They survive model swaps, harness swaps, code rewrites, and doc decay. If any of these change, it's a new project.

### 1. The spec

`tool-spec.v0.json` — a typed description of what an agent can do on a webpage.

- 6-verb DSL: `click` / `fill` / `select` / `check` / `submit` / `read`
- Role+name targets (no CSS selectors, no XPath)
- Risk labels: `low` / `medium` / `high`
- Postconditions: `textPresent` / `urlMatches` / `elementExists`

Full schema: [`CONTRACT.md`](./experiments/CONTRACT.md). Frozen at v0. Bumps become v1; v0 specs keep working.

### 2. The verification loop

```
observe → act → assert
```

Same shape as [gateproof](https://gateproof.dev). Before every tool invocation: verify the target exists. After every invocation: verify the postcondition. `risk: high` gates on HITL. `risk` itself is **computed** from the DSL, not taken from the synthesizer — so an adversary can't downgrade it.

### 3. The auth invariant

> **The browser is the auth.**

The agent runs inside your authenticated tab. Your cookies. Your localStorage. Your credentialed fetches. When you're signed in, the agent is signed in as you. When you close the tab, the agent loses access.

No OAuth dance. No credential storage. No delegation protocol. When invisible credentials are actually invisible, there's nothing to delegate.

### 4. The Directory

A URL-keyed registry of what's been scouted. Fingerprinted by page structure. Shared across users. If someone scouted this URL yesterday and nothing material changed, you get the catalog for free.

- `GET /d/` — everything
- `GET /d/:domain` — per-domain view
- `GET /d/catalog/:fingerprint` — fetch a tool catalog
- `POST /d/catalog` — publish one

Self-host and it runs against your own account. Use [the shared one](https://unsurf-api.coey.dev) and it runs against mine.

---

## The liquid parts

These are expected to change. Don't get attached. The spec and the loop don't care which of these you pick.

| Liquid part | Today | Tomorrow |
|---|---|---|
| **Synthesizer** | Qwen 2.5 Coder 32B via Workers AI | Whatever's cheaper + better |
| **Extraction** | raw HTTP fetch + cleanup | Browser Rendering a11y tree / smart-dom-reader / something new |
| **Runner** | Puppeteer (Node) or WebMCP polyfill (browser) | Same DSL, different host |
| **MCP client** | @modelcontextprotocol/sdk stdio | HTTP / SSE / whatever MCP standardizes on |
| **Browser extension** | Chrome MV3 + @mcp-b | Firefox / Safari / Arc / Dia / whoever |
| **Prompt** | current intent-shaped synthesis prompt | Noisier as models improve, then gone |
| **Source code** | what you're looking at | auto-regenerated from the spec when needed |
| **This README** | what you're reading | runoff from the spec |

If the model leaps ahead, the prompt gets thinner. If the extension ecosystem fragments, the polyfill moves. If Playwright dies, Lightpanda replaces it. **Nothing in the liquid column is worth defending.**

---

## Use it

### As a library (API capture path)

```bash
npm install unsurf
```

```typescript
import { scout, worker, heal } from "unsurf"
```

### As an MCP server

```json
{
  "mcpServers": {
    "unsurf": { "url": "https://unsurf-api.coey.dev/mcp" }
  }
}
```

Streamable HTTP. Works anywhere MCP works.

### As an extension

Install the unsurf extension + @mcp-b local relay. Open a page. If it's in the Directory, the tools appear in your MCP client. Invoke them. They run inside your tab, as you.

```
pages/
  └─ examples/webmcp-extension/   # copy, fork, rewrite — it's ~200 lines
```

### Self-hosted

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/unsurf)

```bash
git clone https://github.com/acoyfellow/unsurf && cd unsurf
bun install && bun run deploy
```

---

## Two capture paths, one loop

```
Agent                  unsurf                     Target site
  │                       │                            │
  │  scout(url)           │  → capture network ──────▶│   → OpenAPI + paths
  │                       │  → capture DOM ─────────▶│    → tool-spec.v0.json
  │                       │                            │
  │  worker(id, args)     │  → replay API via fetch  │
  │                       │  → invoke tool in tab   ──│──▶ runs as user
  │                       │                            │
  │  heal(id, error)      │  → re-scout, patch      ─▶│
```

Same `scout / worker / heal` shape you already know from [unsurf v0](https://github.com/acoyfellow/unsurf). Network capture is the original path. DOM capture is the new one. Pick whichever fits the site. Some sites get both.

---

## Dogfood

unsurf runs on Cloudflare primitives all the way down:

- **Workers** — runtime
- **Workers AI** — synthesis (Qwen 2.5 Coder 32B)
- **Browser Rendering** — scout
- **D1 + R2** — Directory storage
- **MCP endpoint** — `unsurf-api.coey.dev/mcp`

Every piece pays for itself at the edge. If Workers AI improves, unsurf improves. If Browser Rendering gets cheaper, unsurf gets cheaper. No moat around the liquid parts — that's the point.

Adjacent tools in the same worldview:

- [gateproof](https://gateproof.dev) — `observe / act / assert` for agent loops. Same verification shape as unsurf's invocation gate.
- [lab](https://lab.coey.dev) — run agent code, get proof it worked. unsurf tool executions can emit lab-shaped receipts.
- [liquid primitives](https://coey.dev/liquid-primitives) — the philosophy this README is written in.

---

## Built with

- [Effect](https://effect.website) — typed errors, streams, dependency injection
- [Alchemy](https://alchemy.run) — infra as TypeScript
- [Drizzle](https://orm.drizzle.team) — D1 schemas
- [@mcp-b](https://docs.mcp-b.ai) — WebMCP polyfill + local relay
- [MCP SDK](https://modelcontextprotocol.io) — client + transports

## Why Effect

Every operation in unsurf can fail. Browsers crash. Sites change. Networks drop. Synthesizers hallucinate.

| Problem | Effect solution |
|---|---|
| Browser container leaks | `Scope` + `acquireRelease` |
| Transient failures | `Schedule.exponential` + `retry` |
| Typed error routing | `Schema.TaggedError` + `catchTag` |
| Inject synthesizer/store/browser | `Layer` + `Context.Tag` |
| CDP event streams | `Stream` |
| LLM fallback | `ExecutionPlan` |
| Spec + OpenAPI + tool-spec from one source | `Schema` |

## What unsurf isn't

- **Not a framework.** Two verbs, one catalog. If you need a framework for this, you're over-thinking it.
- **Not a platform.** No signups, no metered API, no tier chart. Self-host or use the shared instance.
- **Not a model company.** Workers AI does synthesis. When the model gets better, unsurf gets better automatically.
- **Not a replacement for headless-browser agents.** It's cheaper when a tool exists. When it doesn't, fall back to the thing that works.

It's a seed. The spec is the seed. Everything else regenerates around it.

---

## What's real right now

No version numbers. No roadmap. Here's what works today:

- API capture + replay via `scout / worker / heal` — production, battle-tested.
- WebMCP capture via `scout-dom` — works on sites with interactive HTML + clean ARIA. Tested on Midjourney, coey.dev, jordancoeyman.com, httpbin, and a handful of forms. Doesn't work on every site yet, and won't until the synthesizer improves (which it will).
- Extension invocation — Chrome MV3, ~200 lines, inherits your session.
- Directory — live, dual-type, free to read, free to write.

If you want receipts: [`experiments/SUMMARY.md`](./experiments/SUMMARY.md). Full thesis, benchmarks, and every honest limitation I found.

**Scouts arrive weekly.** If unsurf doesn't scout your site yet, scout it and publish. The Directory is the changelog.

## License

MIT
