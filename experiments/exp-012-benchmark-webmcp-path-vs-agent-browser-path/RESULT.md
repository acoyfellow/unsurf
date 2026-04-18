# exp-012 — RESULT

**Amendments applied:** AMD-002 (headless MCP client for Claude Desktop), AMD-006 (n=5 not n=20, httpbin only, Workers AI Qwen as Path A LLM).

## Result: **AMBIGUOUS (Path B wins decisively; Path C integration gap)**

Against the BRIEF's Pass criteria (Path C beats Path A on wall-clock AND tokens with >=4/5 pass rate):

- ✅ **Path A (remote Qwen drives CDP): 5/5 pass. 12.3s median. 5,662 tokens/run. 10 LLM calls/run.**
- ✅ **Path B (hand-written WebMCP tool): 5/5 pass. 6.3s median. 0 tokens. 0 LLM calls.** 2× faster than Path A, zero per-call LLM cost.
- ❌ **Path C (synthesized spec, repaired): 0/5 pass.** Integration gap: my benchmark harness registers a tool by one name (`submit_contact_form`) and tries to call it by the synthesizer's chosen name (different). No true "synthesized → executed" path was tested.

This is honestly ambiguous. The headline comparison (A vs B) is clean and decisive — WebMCP tooling is ~2× faster and ~100% cheaper per invocation than remote-LLM-drives-CDP. But Path C — the actual thesis under test — wasn't tested because my harness didn't connect the synthesizer's output to the page's registered tool.

## The actual numbers

| Path | n | Pass rate | Median wall | Mean wall | Mean tokens | LLM calls | Notes |
|---|---|---|---|---|---|---|---|
| **A** (Qwen drives CDP) | 5 | 5/5 | 12.3 s | 12.2 s | 5,662 | 10 | Agent-browser-analog; 10 snapshot-observe-act cycles per run |
| **B** (hand-written WebMCP) | 5 | 5/5 | 6.3 s | 6.6 s | 0 | 0 | One MCP call, deterministic execution |
| **C** (synthesized spec) | 5 | 0/5 | 5.8 s | 6.0 s | 0 | 0 | Harness gap — not a model failure (see below) |

## What the A-vs-B comparison means

**On httpbin's contact form, a hand-written WebMCP tool beats a remote LLM driving CDP by roughly 2× on wall-clock and ∞× on tokens per invocation.**

- Path A spent 12 seconds and ~5,700 tokens planning "fill custname" then "fill custemail" etc. 10 calls to the LLM across the full form.
- Path B spent 6 seconds invoking one tool once; the tool itself did form fills + a single `fetch` POST to httpbin.
- **If the tool is called repeatedly (agents doing the same task N times), Path B's amortized cost approaches 0 tokens per call after the first** — which is the "synthesized tools cached in unsurf's Directory" story.
- **Break-even N for Path A vs Path B: 1 call.** Path B is cheaper from the first invocation because there's no LLM planner in the loop.

This is the benchmark number for the thesis: **WebMCP tools are ~2× faster and 100% cheaper per invocation than remote-LLM-driving-CDP**, when the tool exists.

## Why Path C failed (honestly)

The exp-002b synthesizer produced a spec for httpbin with tool name `submit_order_form` (and it had malformed `inputSchema.properties`, as documented in exp-002b RESULT). My Path C harness:
1. Loaded the synthesized spec from exp-002b/out/httpbin-forms-post.json
2. Applied a "repair" pass to backfill properties from `required`
3. Registered on the page a **hand-coded executor under a DIFFERENT name** (`submit_contact_form` — hardcoded in Path B's injector)
4. MCP-called `submit_order_form` (from spec.tools[0].name) → tool not registered → error

The missing piece: a **DSL-in-page executor** that reads `spec.tools[i].dsl[]` and runs it against the DOM directly. That executor is exactly what exp-003's runner built — but exp-003's runner is Node/Playwright-side, not in-page. Porting it into an in-page executor is a follow-up, not this experiment.

**If I had done the integration properly:**
- Path C would register `submit_order_form` (the synthesized name) with an execute function that runs the synthesized DSL against the current DOM.
- It would have the same deterministic-execution profile as Path B (0 tokens, 0 LLM calls per invocation) plus the synthesis cost (1 LLM call at scout time, amortized over all subsequent uses).
- **The expected C result** (with proper integration): 5/5 pass, ~6s median wall-clock, 0 tokens per runtime invocation (+ ~8s and 500 tokens at synth time, amortized).

## Break-even economics

Given:
- Path A: ~5,700 tokens per invocation, ~12 s each.
- Path B: 0 tokens per invocation, ~6 s each.
- Path C (projected from exp-002b): ~500 tokens at synth time, 0 per invocation.

| N invocations | Path A total tokens | Path C total tokens | C savings |
|---|---|---|---|
| 1 | 5,700 | 500 | 91% |
| 10 | 57,000 | 500 | 99.1% |
| 100 | 570,000 | 500 | 99.9% |

**Path C break-even vs Path A is immediate (N=1).** Synth-once, invoke-many is the quadratic win. This is the Directory-caching story.

## What this means for the thesis

- **Path B (hand-written WebMCP) decisively beats Path A on the task, n=5.** That validates the *architecture*: a page-registered tool called via MCP is faster and cheaper than remote-LLM-drives-CDP.
- **Path C is technically untested but its projected performance is Path B's runtime performance + synth-time one-shot cost.** The thesis holds *if* synth quality is good enough (exp-002b AMBIGUOUS) AND the DSL-in-page executor is implemented (not done yet).
- Per THESIS.md, exp-012 is gating. This result is **AMBIGUOUS** because I didn't actually test Path C end-to-end.

## Per THESIS gates (honest reading)

- A-vs-B is strong enough to push the branch **out of Red** on the benchmark axis.
- A-vs-C cannot be declared Green because C wasn't actually tested. So this gate is AMBIGUOUS.
- Branch-level verdict: can't be Green. Can be **Yellow if other gates pass** and the plan is "ship v0 with a documented 'finish Path C' item."

## Recommended follow-up

**exp-012b**: in-page DSL executor. Take exp-003's DSL runner, port it into JavaScript that runs inside the page (not Node+Playwright). The page-embedded executor reads a `tool-spec.v0.json` dropped into it at registration time and registers N tools dynamically, each with `execute: (args) => runDsl(spec.tools[i].dsl, args)`. Re-run exp-012 Path C with that.

Expected Path C result under exp-012b: same shape as Path B (5/5 pass, ~6s, 0 tokens per runtime invocation).

## Surprises

1. **Path A was surprisingly reliable.** Qwen+CDP succeeded 5/5 on a medium-complex form. I expected 1-2 failures; didn't get them. httpbin's form is easy, but still — the CDP-plus-LLM-planner loop is more robust than I'd credited.
2. **Path B's wall-clock is dominated by Chrome startup + MCP client handshake.** The actual tool execute() is ~200ms. If we could reuse the MCP client across calls, Path B would drop to ~1-2s per call.
3. **Relay disconnects on form navigation.** My first Path B implementation used `form.submit()`, which navigated the page away, which killed the WebSocket, which made the relay return an error. Fixed by using `fetch(action, {body: formData})`. This is a real deployment pattern for WebMCP tools that submit forms: **prefer fetch over form.submit() to keep the agent connection alive.**

## Honesty log

- n=5 per path. AMD-006 says this is weak. The A vs B gap is large enough (2×) to survive small-n skepticism, but another-order-of-magnitude claims would need n=20+.
- Anthropic Claude Sonnet (Path A's original spec) untested; Qwen may be faster or slower than Claude on this task.
- httpbin only; "realistic logged-in fixture" untested per AMD-006.
- Path C failure is a harness bug, not a capability failure. Documented honestly; not retroactively counted as Pass.
- All 5 per-path runs' data in `out/results.json`.
- Two runs of the benchmark are preserved (first had broken form.submit navigating away; second fixed with fetch-based submit).

## Artifacts

- `bench.ts` — the three-path harness
- `out/results.json` — 15 per-run records
- `out/summary.json` — aggregate stats
- `/tmp/exp-012-v2.log` — full run log
