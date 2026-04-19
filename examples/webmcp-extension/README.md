# unsurf — Chrome extension

```
surf the web → unsurf it
```

A ~200-line Chrome MV3 extension. Visits a page. Asks the [unsurf Directory](https://unsurf.coey.dev/directory) what tools exist for this URL. Registers them on the page via `navigator.modelContext`. Your MCP client (Claude Desktop, Cursor, Zed, anything speaking MCP) sees the tools and calls them.

**The tools run inside the logged-in tab.** Your cookies, your localStorage, your credentialed fetches. No credential storage, no OAuth dance, no delegation. The agent's "you" is the tab's "you".

## Install

### 1. Load the extension

```bash
git clone https://github.com/acoyfellow/unsurf
```

In Chrome: `chrome://extensions` → toggle **Developer mode** → **Load unpacked** → select `unsurf/examples/webmcp-extension/`.

### 2. Install the relay (for your MCP client)

The extension exposes tools to the page; your MCP client reads them via the local relay.

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

Works with Claude Desktop, Cursor, Zed, Claude Code, anything that speaks MCP.

### 3. Browse

Visit any page. If the Directory has a catalog for it, the unsurf popup shows `N tools`. The same tools appear in your MCP client. Ask it to invoke one.

## How it works

```
page load
  │
  ▼
content script (isolated world)
  │  1. inject polyfill.iife.js       ──► navigator.modelContext exists in page
  │  2. inject injected.js            ──► page-side registrar + DSL runner
  │  3. fetch Directory catalog for this URL
  │  4. relabel risk via deterministic rules (belt-and-suspenders)
  │  5. postMessage {type: "unsurf:register-catalog", catalog}
  ▼
injected.js (main world)
  │  - receives catalog
  │  - for each tool: navigator.modelContext.registerTool(spec)
  │  - execute() runs the DSL against the live DOM
  │  - risk:"high" → window.confirm() HITL gate
  ▼
embed.js
  │  - opens WebSocket to webmcp-local-relay on :9333
  │  - exposes registered tools
  ▼
@mcp-b/webmcp-local-relay (stdio MCP server)
  │  - your MCP client connects here
  ▼
Claude / Cursor / Zed / …
```

The two liquid pieces (polyfill + embed) come from [mcp-b](https://docs.mcp-b.ai) and are bundled locally — the extension is self-contained, no `npm install` required.

## Security

- **Deterministic risk labeling** — the Directory computes `risk` from the DSL structure, and the extension recomputes it on arrival. The synthesizer's claimed risk is never trusted. See [`src/services/RiskLabeler.ts`](../../src/services/RiskLabeler.ts).
- **HITL on `risk: "high"`** — any tool that submits a form or clicks a destructive button (delete, pay, buy, send, cancel, etc.) prompts via `confirm()` before executing. No silent submits.
- **Isolated world content script** — the extension never has access to the page's JS state. It communicates with the page via `postMessage`.
- **Directory catalogs pass through RiskLabeler on ingest** — even if a hostile page were scouted, its stored catalog is normalized before anyone pulls it.

## Configuration

Click the unsurf toolbar icon → edit the API endpoint at the bottom of the popup. Defaults to `https://unsurf-api.coey.dev`. Self-host your own Directory and point here.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. `<all_urls>` host permission, `storage` + `activeTab` + `scripting`. |
| `content.js` | Isolated-world content script. Fetches catalog, relabels risk, injects page scripts. |
| `injected.js` | Main-world script. Receives catalog, registers tools, runs 6-verb DSL against the DOM. |
| `background.js` | Service worker. Logs per-tab visits for the popup. |
| `popup.html` / `popup.js` | Small UI. Shows recent visits + tool counts. Lets you change the API endpoint. |
| `polyfill.iife.js` | `@mcp-b/webmcp-polyfill` — adds `navigator.modelContext`. Copied from npm. |
| `embed.js` + `widget.html` + `widget.js` | `@mcp-b/webmcp-local-relay` browser bridge. Copied from npm. |

## Status

v0.0.1. The [liquid primitives](https://coey.dev/liquid-primitives) apply: this extension is disposable. The spec (`tool-spec.v0.json`), the verification loop (observe/act/assert + deterministic risk), the auth invariant, and the Directory are the solid parts. When Chrome's WebMCP lands natively, the polyfill drops out; when MCP transports change, `embed.js` gets swapped; everything else stays.

## What doesn't work yet

- **Directory API** — `GET /d/catalog?url=...` is the endpoint the extension fetches. The Directory's WebMCP catalog storage is not yet live on `unsurf-api.coey.dev`. Until it is, this extension will show 0 tools on every page (misses, not errors). Track progress in [experiments/SUMMARY.md](../../experiments/SUMMARY.md).
- **Firefox / Safari** — Chrome MV3 only for now. The MV3 shape is ~90% portable; contributions welcome.
- **Complex SPAs** — role+name targeting can miss on heavily React-rendered pages (see [`experiments/exp-003-.../RESULT.md`](../../experiments/exp-003-can-six-verb-dsl-execute-on-ten-real-sites/RESULT.md)). A fallback ladder is on the roadmap.

## Philosophy

The browser is the auth. The page's tools are the agent's tools. The Directory is the changelog. Everything else is liquid.

MIT.
