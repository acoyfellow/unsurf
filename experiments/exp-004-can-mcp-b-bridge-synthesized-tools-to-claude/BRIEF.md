# exp-004-can-mcp-b-bridge-synthesized-tools-to-claude

## Question
Determine whether a Chrome extension using `@mcp-b/webmcp-polyfill` can register a single hand-coded tool and have Claude Desktop successfully discover and invoke it via `@mcp-b/webmcp-local-relay`.

## Why this question
This is the pipe-integrity test for the entire extension-mode path. Every other WebMCP-capture experiment (synthesizer quality, DSL execution, fingerprinting, directory catalog) is wasted effort if the bridge from a page-registered tool to a real MCP client doesn't actually work end-to-end. Answering Pass unlocks the extension as a distribution channel; answering Fail forces unsurf to ship as a standalone CLI/native-host instead, collapsing several downstream experiments. It also rules out the possibility that mcp-b's docs describe a path that only works in a demo context.

## Method
1. Read mcp-b.ai docs and the `@mcp-b/webmcp-polyfill` + `@mcp-b/webmcp-local-relay` READMEs to confirm current install surface (package names, relay binary, host config path).
2. Scaffold `examples/webmcp-extension/` as a Manifest V3 Chrome extension with: `manifest.json`, `background.ts` (service worker), `content.ts` (content script), `injected.ts` (page-world script), and `package.json` pulling in `@mcp-b/webmcp-polyfill` and `@mcp-b/webmcp-local-relay` at their current versions.
3. In `injected.ts`, call the polyfill to register exactly one tool: `get_page_title` with empty input schema (`{"type":"object","properties":{}}`) whose handler returns `{ title: document.title }`.
4. Wire `content.ts` to inject `injected.ts` into the page world on `document_start` for `https://example.com/*` and `https://news.ycombinator.com/*`.
5. In `background.ts`, establish the relay transport per `@mcp-b/webmcp-local-relay` docs so the extension bridges page-world tools to a local MCP server socket.
6. Produce a `claude_desktop_config.json` snippet under `examples/webmcp-extension/claude_desktop_config.example.json` pointing `mcpServers.webmcp` at the local-relay stdio/websocket entry per the mcp-b docs.
7. Load the unpacked extension in Chrome (Developer Mode), install the config into `~/Library/Application Support/Claude/claude_desktop_config.json`, restart Claude Desktop.
8. Open `https://example.com/` in Chrome with the extension active. In Claude Desktop, open the tools panel and verify `get_page_title` is listed.
9. From Claude Desktop, invoke `get_page_title`. Record: (a) whether the call reaches the page, (b) the returned value, (c) latency.
10. Repeat step 8–9 with `https://news.ycombinator.com/` to confirm it isn't example.com-specific.
11. Capture a screenshot of Claude Desktop showing the tool list entry and a successful tool call with the returned `title`.
12. Write `RESULT.md` with Pass/Fail/Ambiguous, observed failure modes if any, and the exact versions of `@mcp-b/webmcp-polyfill`, `@mcp-b/webmcp-local-relay`, and Claude Desktop used.

## Inputs
- `@mcp-b/webmcp-polyfill` (npm, current version)
- `@mcp-b/webmcp-local-relay` (npm, current version)
- mcp-b.ai documentation
- Claude Desktop (installed locally)
- Two test URLs: `https://example.com/`, `https://news.ycombinator.com/`
- No `tool-spec.v0.json` input — tool is hand-coded.

## Outputs
- `examples/webmcp-extension/` — loadable MV3 Chrome extension source (manifest, background, content, injected, package.json, tsconfig if needed, README with load instructions).
- `examples/webmcp-extension/claude_desktop_config.example.json` — the exact snippet to merge into a user's Claude Desktop config.
- `experiments/exp-004-.../screenshots/claude-tool-list.png` and `claude-tool-call.png`.
- `RESULT.md` with Pass/Fail/Ambiguous + observed versions + any bridge bugs encountered.
- Does **not** produce `tool-spec.v0.json`.

## Kill-by
3 hours. If the relay won't connect or Claude Desktop refuses to discover the tool after 3 hours of debugging, write RESULT.md as Fail with the failure mode and stop.

## Pass / Fail / Ambiguous criteria
- **Pass** = Claude Desktop lists `get_page_title` in its tool panel AND a call from Claude returns `{ title: "Example Domain" }` for example.com AND returns the correct `<title>` for news.ycombinator.com. Screenshots captured.
- **Fail** = The tool never appears in Claude's tool list after extension load + config install + Claude restart, OR the tool appears but every invocation errors/times out.
- **Ambiguous** = Tool appears and calls succeed intermittently (e.g., works on first page load but not after tab switch), OR works only when Chrome DevTools is open, OR requires manual relay process that the README didn't document. Document the flakiness pattern in RESULT.md.

## What could surprise us
- The relay requires a separately-installed native binary (not just an npm package), meaningfully raising the install-friction bar for unsurf users.
- mcp-b's polyfill registers tools per-page, but Claude Desktop only sees tools from the currently-focused tab — making "many unsurfed sites" effectively one-at-a-time rather than a persistent catalog.
- Tool invocations from Claude work only when the originating tab is foregrounded, revealing that the relay can't drive background tabs — which would constrain how the DomWorker (exp-003) integrates.

## Integration target
If Pass, graduates as a new package at `examples/webmcp-extension/` — the client-side companion to unsurf. A later experiment (likely a sibling of exp-011) will replace the hand-coded `get_page_title` with tools materialized from `tool-spec.v0.json` fetched from `src/services/Directory.ts`. No changes to existing `src/` files in this experiment.

## Contract interaction
Neither produces nor consumes `tool-spec.v0.json`. The hand-coded tool deliberately bypasses the contract to isolate bridge plumbing from synthesis quality. Downstream experiments will layer the contract on top of this extension shell.

## Out of scope
- Synthesizing tools from a page's DOM (that is exp-001 / exp-002).
- Executing the six-verb DSL (that is exp-003).
- Fingerprinting or directory lookup of tools (that is exp-007 / exp-011).
- Supporting MCP clients other than Claude Desktop (Cursor, Zed, etc.).
- Registering more than one tool, or tools with non-empty input schemas.
