# exp-012-benchmark-webmcp-path-vs-agent-browser-path

## Question
Does a synthesized WebMCP tool (Path C) beat remote CDP-driven agent-browser (Path A) on wall-clock and tokens for one concrete form-submit task, and by how much?

## Why this question
This is the thesis check. Every other experiment in this branch is plumbing; this one is the number we bet on. A decisive Path C win on both axes justifies graduating the synthesizer → runner → bridge chain into `src/` and writing the external memo. A Path C loss tells us the synthesis quality (exp-001/002) or the DSL (exp-003) is the bottleneck and names the next question. An ambiguous result rules out "just ship it" and forces a v1 spec conversation before any graduation.

## Method
1. **Task fixture (identical across all paths).** The task prompt given to every driving LLM is: *"Go to https://httpbin.org/forms/post. Fill the form with custname='Unsurf Bench', custtel='555-0100', custemail='bench@unsurf.dev', size='medium', topping=['bacon','cheese'], delivery='20:00', comments='benchmark run'. Submit the form. Return the JSON the server echoes back."* httpbin echoes POSTed form data as JSON, which gives an unambiguous success oracle. This is the SIMPLE CASE. Second fixture (realistic case): a logged-in task — Go to https://linear.app/<user-workspace>/inbox and mark the top notification as read. Or, if Linear is unavailable, a logged-in GitHub task: Go to https://github.com/acoyfellow/unsurf/issues and close any open issue (create a dummy issue first if none exists). Success oracle = the target UI state change (notification marked read / issue closed) is observable on reload.
2. **Success oracle.** A run is a Pass iff (a) the HTTP response body after submit contains `"custname": "Unsurf Bench"` and `"custemail": "bench@unsurf.dev"` in the echoed `form` object, AND (b) the driving agent returns that payload to the caller. Any other outcome (timeout, wrong fields, crash, refusal) is a Fail.
3. **Path A — agent-browser CLI (remote Sonnet drives CDP).** Use the current `unsurf` agent-browser skill / CLI path: Claude Sonnet 4.5 (`claude-sonnet-4-5`) over the Anthropic API, driving headless Chrome via CDP. Wrap the invocation in a harness that records: start timestamp, end timestamp, every LLM request (model, input_tokens, output_tokens, latency_ms), and final result.
4. **Path B — hand-written WebMCP tool, Claude Desktop.** Author one hand-written WebMCP tool `submit_httpbin_contact_form` in a tiny page-embedded script using the `@mcp-b` polyfill (as used in exp-004). Claude Desktop (Sonnet 4.5 configured) calls it with the fixture arguments. Harness records the Desktop conversation tokens via the Anthropic usage log export + wall-clock via timestamps in the page's console output.
5. **Path C — synthesized WebMCP tool, Claude Desktop.** Take `tool-spec.v0.json` produced by exp-001 (or exp-002 if exp-001 did not ship) for `https://httpbin.org/forms/post`, run it through the exp-003 runner + exp-004 `@mcp-b` bridge, register it with Claude Desktop, call with fixture arguments. Same harness as Path B.
6. **Runs:** 20 runs per path per fixture (simple httpbin + realistic logged-in) = 120 total runs minimum. Cold start each. Space >=30s apart. If 20 runs per cell cannot complete within kill-by, drop to 10 per cell and note in RESULT.md that statistical power is weaker.
7. **Measurement table.** Produce one CSV `results.csv` with columns: `path, run_idx, wall_clock_ms, total_input_tokens, total_output_tokens, total_tokens, llm_calls, result (pass|fail|ambiguous), failure_reason`. Derive one summary table `summary.md` with rows A/B/C and columns: median wall-clock, mean total tokens, pass rate (n/5).
8. **Degraded mode.** If exp-001 and exp-002 did not ship a valid `tool-spec.v0.json` by spawn time, drop Path C. If exp-003 runner did not ship, drop Path C. If exp-004 bridge did not ship, drop Path C. Run A vs B only and flag RESULT.md as `partial`.
9. **Write `RESULT.md`** with the summary table, the CSV path, the decision (see criteria below), and two paragraphs: what this means for graduation, and what the next experiment should be.
10. Amortization analysis. Path C has a one-time synthesis cost (tokens to synthesize the tool) plus a per-call execution cost. Path A has no synthesis cost but a higher per-call cost. Compute the break-even N: the number of task invocations at which Path Cs cumulative cost equals Path As. Report: break_even_N_tokens (break-even on total billed tokens) and break_even_N_seconds (break-even on cumulative wall-clock). For Path A this is always N=0 (no amortization); for Path C, N > 0. Present this as a two-line statement per fixture in summary.md.

## Inputs
- Fixture URL: `https://httpbin.org/forms/post`.
- Path A: current `unsurf` agent-browser CLI entry point (repo-local, whatever binary/skill exists on the branch); Anthropic API key; `claude-sonnet-4-5`.
- Path B: hand-written WebMCP tool script (authored inside this experiment folder as `path-b-tool.js`, not graduated anywhere); `@mcp-b` polyfill; Claude Desktop with MCP configured.
- Path C: `tool-spec.v0.json` for `https://httpbin.org/forms/post` from exp-001 output (preferred) or exp-002 output; exp-003 DSL runner; exp-004 `@mcp-b` bridge.
- Anthropic usage export endpoint / console for Path B & C token accounting.

## Outputs
- `results.csv` — 15 rows, one per run (or 10 in degraded mode).
- `summary.md` — 3-row (or 2-row) comparison table.
- `path-b-tool.js` — the hand-written WebMCP tool source (kept for reproducibility, not graduated).
- `harness.ts` — the timing + token-accounting wrapper used for Path A (kept, not graduated).
- `RESULT.md` — Pass/Fail/Ambiguous + graduation recommendation.
- Does **not** produce `tool-spec.v0.json`. Consumes one (Path C).

## Kill-by
3 hours. If exceeded, write `RESULT.md` with whatever runs completed (even 1 per path is publishable if labeled n=1) and stop.

## Pass / Fail / Ambiguous criteria

This experiment is THESIS-GATING (see THESIS.md). Criteria are pre-registered and NOT edited after pilot runs.

- **Pass (Green)**: On BOTH fixtures (simple + realistic), Path C succeeds >=16/20 runs (>=80%) AND Path C median wall-clock <= 0.5x Path A median AND Path C mean tokens-per-call <= 0.25x Path A mean. AND break_even_N_tokens <= 20 on the realistic fixture (Path C pays for itself within 20 uses).
- **Ambiguous (Yellow)**: Path C succeeds >=14/20 on both fixtures AND wins on EITHER wall-clock OR tokens but not both, OR wins on both but break_even_N > 20. Ships with documented limits in THESIS.md Yellow state.
- **Fail (Red)**: Path C succeeds <14/20 on either fixture, OR Path C mean tokens >= Path A mean tokens, OR break_even_N > 100 on the realistic fixture, OR n<10 runs per cell and variance too wide to conclude anything. Kills the branch until the bottleneck (synthesis quality? DSL coverage? bridge flakiness?) is identified in RESULT.md.

## What could surprise us
1. Path A wins on wall-clock because Claude Desktop's MCP round-trip latency (client → desktop → tool → back) is higher than we assumed, even though CDP bootup is slow.
2. Path C token count is dominated by the *tool description* Claude Desktop loads into context on every call, making the per-call token savings smaller than projected — argues for terser `description` fields in the contract.
3. Path B (hand-written) fails at 5/5 because `@mcp-b` polyfill + Claude Desktop has a quirk (stale tool registration, race on page nav) that exp-004 did not surface. If Path B is flaky, Path C cannot be less flaky; the whole bridge story needs another experiment.

## Integration target
If Pass: the harness graduates into `examples/benchmarks/webmcp-vs-agent-browser/` (new folder under the existing `examples/`), and the summary table becomes the headline number in the blog post and internal memo. No `src/` files change from this experiment directly — it's measurement, not code — but a Pass unblocks the graduation of: exp-001/002 synthesizer → `src/ai/DomSynthesizer.ts` alongside `src/ai/ScoutAgent.ts`; exp-003 DSL runner → `src/tools/DomWorker.ts` alongside `src/tools/Worker.ts`; exp-004 bridge → `examples/mcp-b-bridge/`; exp-011 catalog fields → `src/services/Directory.ts` + `src/db/schema.ts`.

## Contract interaction
Consumes `tool-spec.v0.json` in Path C only. Does not produce one. Fields this experiment specifically exercises and reports on:
- `tools[i].inputSchema` — the fixture arguments must validate against it; a mismatch is a Fail and a contract-quality signal worth calling out in RESULT.md.
- `tools[i].dsl` — end-to-end executability via exp-003 is the critical path for Path C.
- `tools[i].risk` — if the synthesized spec labels the submit as `high`, the runner's HITL prompt (exp-003) is in the latency path and must be counted in wall-clock or bypassed via a benchmark flag; RESULT.md must state which.
- `tools[i].postcondition` — if present, post-check latency is included in wall-clock.

## Out of scope
- Benchmarking any site other than `https://httpbin.org/forms/post`. One task, three paths. Generalization is a future experiment.
- Evaluating synthesis quality across models (that's exp-001 vs exp-002).
- Testing heal/re-scout behavior when the page changes (that's a separate experiment).
- Cost modeling in dollars (report tokens; $ conversion belongs in the memo, not the experiment).
- Graduating any code into `src/` — this experiment produces a number, not a shipped feature.

## Independent verification

This experiments results are thesis-critical. Before RESULT.md can be labeled Pass, the summary.md table must be reproduced on a second machine (different network, different Chrome profile, clean install). If the second run disagrees on Pass/Fail classification, the result is Ambiguous until the discrepancy is explained. Note in RESULT.md: who ran the independent verification and on what hardware.
