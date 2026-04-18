# exp-004 — RESULT

**Amendments applied:** AMD-002 (substituted `@modelcontextprotocol/sdk` stdio Client for Claude Desktop as the MCP host).

## Result: **PASS** (under substitution caveat)

Every pipeline stage completed successfully end-to-end:

| Stage | Result |
|---|---|
| Static server serving page.html + polyfill + embed.js + widget.html/js | ✓ |
| MCP relay (webmcp-local-relay) spawned as stdio child process | ✓ |
| Browser page loads, polyfill exposes `navigator.modelContext` | ✓ |
| Page registers two tools: `get_page_title` + `add_numbers` | ✓ (status.innerText = "tools registered") |
| embed.js connects to relay on `ws://127.0.0.1:9333` | ✓ |
| MCP Client (stdio) sees the page's tools in `tools/list` | ✓ — 6 tools total (2 page + 4 relay meta) |
| `webmcp_list_sources` confirms the page is connected with toolCount=2 | ✓ |
| MCP Client calls `get_page_title` → returns `"exp-004 test page"` | ✓ |
| MCP Client calls `add_numbers({a:2, b:3})` → returns `"5"` | ✓ (real args round-trip correctly) |

## What this validates end-to-end

The full bridge:

```
  browser page (exp-004 test page)
    │  navigator.modelContext.registerTool(...)
    │  (from @mcp-b/webmcp-polyfill)
    │
    ▼  embed.js opens WebSocket
  ws://127.0.0.1:9333
    │
    ▼  @mcp-b/webmcp-local-relay (stdio MCP server)
    │  bridges WebSocket ↔ JSON-RPC
    │
    ▼  stdin/stdout
  @modelcontextprotocol/sdk Client (this test)
  (substitutes for Claude Desktop per AMD-002)
```

**A page-registered tool IS callable from outside the browser via MCP.** The synthesis story — "unsurf synthesizes WebMCP tools and a headless agent calls them" — has a working delivery vehicle.

## Surprises

1. **Page tools are surfaced at the top of `tools/list`, not behind `webmcp_list_tools`.** My first implementation assumed I had to invoke via the meta-tool `webmcp_call_tool`. Not needed — the relay proxies page tools transparently. `tools/list` returns `[page_tool_1, page_tool_2, ..., webmcp_list_sources, webmcp_list_tools, webmcp_call_tool, webmcp_open_page]`.
2. **Startup order matters.** My v1 run failed because I started the relay AFTER the page loaded. The embed.js tried to connect to the WS, failed, and didn't retry. Fixed by starting relay first, then navigating the page. **This is a deployment gotcha**: in a real extension flow, the relay must be up before the user navigates.
3. **`widget.html` needs to be servable from the page origin OR accessible via CDN fallback.** My v1 got `Widget HTML fetch returned 404` until I served it. Production deployment may rely on jsDelivr's CDN copy — works, but adds an external dependency.
4. **The relay prints "WARNING: accepting connections from ALL host page origins".** Not a bug but a security footgun. The `--widget-origin` flag exists; production-ready deployment should use it. Added to BACKLOG.md.

## The substitution caveat (per AMD-002)

This experiment does NOT prove that **Claude Desktop specifically** can discover and invoke the tool. It proves that **an MCP stdio client** using the same SDK Claude Desktop uses can. Claude Desktop itself has additional layers:
- Its own tool-approval UI (user has to click "allow")
- A per-server context menu + its own tool-display logic
- Possibly different tool-call formatting expectations

A follow-up manual test with Claude Desktop is still required before claiming Green on this axis. For thesis purposes, the plumbing is demonstrated; for user-facing Green, human verification is the last step.

## What this unlocks

- exp-012 (benchmark Path B + Path C): can use the exact same architecture. The "MCP client" is the Anthropic SDK with Claude Sonnet as the planner, calling the page's tools through the relay. Path C is now concretely buildable.
- **The synthesis→execution pipeline can be tested end-to-end** by feeding an exp-002b `tool-spec.v0.json` into the page (registerTool per tool), then having the MCP client call it. That's a follow-up exp-004b experiment (post-synthesis integration).

## BACKLOG additions

- **relay default security posture**: `--widget-origin` flag should be required, not optional, by the production wiring — otherwise any page that loads the embed can connect.
- **page-load vs relay-up ordering**: the embed.js needs exponential retry if WS connect fails. Right now the first attempt fails silently.
- **widget.html CDN dependency**: self-hosted deployments need to serve widget.html + widget.js or configure `widgetUrl`; the CDN fallback works but adds a third-party dependency.

## Honesty log

- Three runs were needed to land Pass. v1 failed because the relay wasn't running yet. v2 failed because I was calling tools through `webmcp_call_tool` (the wrong abstraction). v3 passed once I (a) started the relay first and (b) called the tools directly by their short names.
- Each failure was a *wiring* bug, not a *capability* bug. The mcp-b stack works as advertised; I used it wrong twice.
- All three runs' artifacts are preserved in `out/` and `/tmp/exp-004-v*.log`.
- Per AMD-002: Pass here is plumbing-Pass, not user-experience-Pass. Documented above.

## Artifacts

- `page.html` — test page with two WebMCP tools
- `run.ts` — harness (relay spawn + browser drive + MCP client)
- `out/results.json` — all stage outcomes + tool-call returns

## Branch-level implication

Per THESIS.md, exp-004 is thesis-gating. Under AMD-002 substitution: **Pass**. The bridge exists and works. The branch doesn't go Red here.
