# unsurf-daemon

A tiny Bun CLI that attaches to an existing Chrome via CDP and injects `navigator.modelContext` into every page — **no extension required**.

```
Chrome (running)
  │
  │  CDP (port 9222)
  │
  ▼
unsurf-daemon ───► Page.addScriptToEvaluateOnNewDocument ───► polyfill in every tab
  │
  │  Page.frameNavigated
  │
  ▼
fetch(Directory) ───► registerCatalog(spec) ───► tools live on navigator.modelContext
```

## Why this exists

Chrome extensions are blocked by enterprise MDM on many managed machines (`ExtensionInstallBlocklist: ["*"]`). CDP-based injection works where `--load-extension` does not.

It's also a cleaner architecture:
- Works against any Chromium browser exposing CDP: Chrome, Chrome For Testing, Arc, Edge, Brave, Dia, Chromium itself
- No `manifest.json`, no unpacked extension to manage
- Polyfill runs in every new document via `Page.addScriptToEvaluateOnNewDocument`
- ~450 lines, one file, one dependency (Bun's built-in `WebSocket`)

## Run

```bash
bunx unsurf-daemon
```

Or from a clone:

```bash
bun run examples/webmcp-daemon/daemon.ts
```

## Prereq: Chrome must accept CDP

Launch Chrome with the remote-debugging flag:

```bash
open -na "Google Chrome" --args --remote-debugging-port=9222
```

**If your Chrome is enterprise-managed, this flag is probably silently ignored.** Use [Chrome For Testing](https://developer.chrome.com/blog/chrome-for-testing/) instead — it's a separate binary with no MDM:

```bash
"$HOME/.agent-browser/browsers/chrome-147.0.7727.56/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --user-data-dir=/tmp/unsurf-chrome-profile \
  --remote-debugging-port=9222
```

Log into whatever sites you want to give agents access to — once. The profile persists across launches.

## Env

| Variable | Default | Purpose |
|---|---|---|
| `UNSURF_API` | `https://unsurf-api.coey.dev` | Directory endpoint to fetch tool catalogs from |
| `CDP_PORT` | `9222` | Chrome's remote-debugging port |
| `CATALOG_FILE` | — | Path to a local `tool-spec.v0.json` file. When set, this catalog is applied to every URL instead of fetching from the Directory. Useful for testing + offline demos. |

## Demo: run against `coey.dev`

```bash
# 1. Launch Chrome For Testing (one time)
"$HOME/.agent-browser/browsers/chrome-147.0.7727.56/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --user-data-dir=/tmp/unsurf-chrome-profile \
  --remote-debugging-port=9222 &

# 2. Start daemon with the example catalog
CATALOG_FILE=./example-catalog.json bunx unsurf-daemon

# 3. In Chrome, navigate to https://coey.dev/
#    Daemon logs: "coey.dev — registered 3 tool(s)"

# 4. In DevTools console:
await navigator.modelContext.executeTool("read_headline", {})
// => { content: [{ type: "text", text: "hello new world" }] }
```

## Connect an MCP client

The daemon registers tools on the page via `navigator.modelContext`. To make those tools callable from Claude Desktop / Cursor / Zed, run the [@mcp-b/webmcp-local-relay](https://www.npmjs.com/package/@mcp-b/webmcp-local-relay) bridge alongside:

```json
{
  "mcpServers": {
    "unsurf-local": {
      "command": "npx",
      "args": ["-y", "@mcp-b/webmcp-local-relay@latest"]
    }
  }
}
```

The relay opens a WebSocket that talks to the page, and talks to your MCP client over stdio. Your client sees the daemon-registered tools.

## Security

The daemon does **deterministic risk re-labeling** on every catalog — the synthesizer's claimed `risk` is ignored; a pure function of the DSL shape computes the true risk. Any tool with `submit` or a click target whose name matches a destructive verb (`delete`, `pay`, `buy`, `send`, `confirm`, `cancel`, …) is forced to `risk: high` and gated on `window.confirm()` before execution.

The risk function is the same one shipped as [`src/services/RiskLabeler.ts`](../../src/services/RiskLabeler.ts). Defense in depth: the Directory computes it on intake, the daemon recomputes it on arrival.

## What's in the file

- `daemon.ts`
  - CDP discovery (try port → fall back to DevToolsActivePort file)
  - Minimal CDP client using Bun's built-in `WebSocket`
  - Injected payload (the polyfill, 6-verb DSL runner, `registerCatalog`)
  - Target attach / reattach on tab create / destroy
  - Polyfill-ready polling (races with `Page.addScriptToEvaluateOnNewDocument`)
  - Per-URL catalog fetch + register
- `example-catalog.json` — hand-written tool spec for coey.dev. Drop any `tool-spec.v0.json` here to use it.

## Known limits

- **Only targets top-level frames.** Cross-origin iframes don't get the polyfill. v1 problem.
- **Reload re-registers tools from scratch.** Expected. The polyfill resets with the page.
- **No persistence of user-authored tools.** If the daemon dies, the polyfill's registered tools go with it. The Directory is the persistent store.
- **Enterprise-managed Chrome silently refuses `--remote-debugging-port`.** Use Chrome For Testing. See [`.context/MANAGED-CHROME.md`](https://github.com/acoyfellow/unsurf/blob/main/.context/MANAGED-CHROME.md) in Jordan's context repo for why.

## Liquid primitives

The daemon is disposable. The solid parts are:
- **The spec** (`tool-spec.v0.json`) — `CONTRACT.md`
- **The verification loop** — deterministic risk + HITL gating
- **The auth invariant** — the tab is the auth (works on any logged-in tab in any browser the daemon attaches to)
- **The Directory** — where catalogs live

If Bun changes, swap to Node. If CDP changes, swap to BiDi. If Chrome dies, pick another browser. The daemon is the thinnest thing that makes the solid parts reachable today.
