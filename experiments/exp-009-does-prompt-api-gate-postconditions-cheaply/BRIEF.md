# exp-009-does-prompt-api-gate-postconditions-cheaply

## Status: Deferred pending exp-009b (Workers AI ship-path gate)

This experiment tests the FAST-PATH optimization: Chrome in-tab Prompt API (Gemini Nano) for postcondition verification. Because Nano is flag-gated and Canary-only, it cannot be the ship path. The ship path is a Workers AI gate (exp-009b, to be created as a sibling if/when exp-002 passes). exp-009 runs ONLY AFTER exp-009b RESULT.md exists, so that Nano can be compared against the real ship alternative — not only against the trivial deterministic baseline G1.

## Question
Can Chrome's in-tab Prompt API (`LanguageModel.prompt` with `responseConstraint: { type: "boolean" }`) verify a `tool-spec.v0.json` postcondition in under 100ms median and with >90% accuracy against a hand-labeled test set of 10 `(tool, page_state_after, expected_result)` triples?

## Why this question
The CONTRACT defines three deterministic postcondition kinds (`textPresent`, `urlMatches`, `elementExists`), but real pages fail those checks for uninteresting reasons — text changes wording, URLs get tracking params, elements move. If in-tab Gemini Nano can reliably answer "did this tool do what the description said it would?" from a DOM summary, every tool execution gets a free semantic verify with zero network cost. If it can't, we know the fast-path is unreliable and we must route postcondition checks through Workers AI (slower, costs money, but presumably more accurate). This experiment settles which path the runner (exp-003) should take by default.

## Method
1. Build a labeled fixture set of 10 triples in `fixtures/triples.json`. Each triple contains: the synthesized tool spec (minimal — name, description, postcondition), a DOM snapshot string captured *after* a (real or simulated) tool execution, and `expected_result: boolean` (should the gate pass?). Target mix: 4 true-positives (tool clearly succeeded), 3 true-negatives (tool clearly failed — e.g. error banner visible), 3 hard cases (ambiguous wording, partial success, stale UI).
2. Source the DOM snapshots by hand: pick 5 public forms (e.g. `https://httpbin.org/forms/post`, a Netlify contact form, `https://formspree.io/library/contact-form/`, a GitHub issue composer at `https://github.com/acoyfellow/unsurf/issues/new`, and a Google Form). For each, capture post-submit DOM via Chrome DevTools → `document.body.innerText` and `document.documentElement.outerHTML` (truncated to 8KB).
3. Implement two gates in `src/gates.ts`:
   - G1 (deterministic baseline): exact CONTRACT semantics — `textPresent` = case-insensitive substring match on the visible-text snapshot; `urlMatches` = regex against final URL; `elementExists` = presence check via a minimal role+name resolver over the HTML snapshot.
   - G2 (Prompt API): call `await LanguageModel.create({ expectedInputs: [{ type: "text" }] })` then `session.prompt(promptText, { responseConstraint: { type: "boolean" } })`. `promptText` = tool description + postcondition description + truncated DOM summary (first 4KB of innerText).
3.5. Add a THIRD gate G3: Workers AI postcondition check. Call `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via AI Gateway with the same prompt (tool description + postcondition + truncated innerText), `response_format: { type: json_schema, json_schema: { type: object, properties: { pass: { type: boolean } }, required: [pass] } }`. Record G3 result and G3 latency. This gate represents the real ship alternative; Nano must beat it on BOTH accuracy AND latency to be worth the flag dependency.
4. Run each gate against all 10 triples in a Chrome 131+ page (Canary if needed) with Prompt API enabled via `chrome://flags/#prompt-api-for-gemini-nano`. Record per-triple: G1 result, G2 result, G2 latency (`performance.now()` around `session.prompt`), and expected.
5. Produce a confusion matrix for each gate and a latency histogram (p50, p90, max) for G2. Write results to `RESULT.md` with a per-triple breakdown table.
6. Compare: if G2 beats G1 on the 3 hard cases without regressing on the 7 easy ones and p50 latency < 100ms, Pass.

## Inputs
- 10 hand-captured DOM snapshots (`fixtures/snapshots/*.txt` for innerText, `*.html` for outerHTML).
- 10 minimal `tool-spec.v0.json` fragments — just `tools[0].name`, `tools[0].description`, `tools[0].postcondition`. These are *consumed* from the CONTRACT schema.
- Expected labels in `fixtures/triples.json` (manually authored).
- Chrome 131+ with Prompt API flag enabled and Gemini Nano model downloaded (verify via `await LanguageModel.availability()` returning `"available"`).

## Outputs
- `fixtures/triples.json` — the labeled test set (reusable by later experiments).
- `src/gates.ts` — G1 (deterministic) and G2 (Prompt API) gate implementations.
- `src/harness.html` — loads fixtures, runs both gates, renders table.
- `results.json` — raw per-triple results: `{triple_id, g1_pass, g2_pass, g2_latency_ms, expected}`.
- `RESULT.md` — Pass/Fail/Ambiguous, confusion matrices, latency p50/p90/max, and a graduation recommendation.
- Does **not** produce `tool-spec.v0.json` — only consumes the `postcondition` field.

## Kill-by
2 hours. If triple-building drags past 45 minutes, stop at 6 triples and run the analysis with what's there; note the smaller n in RESULT.md.

## Pass / Fail / Ambiguous criteria
- **Pass**: G2 accuracy >= 9/10 AND G2 p50 latency < 100ms AND G2 accuracy >= G3 accuracy AND G2 p50 latency < G3 p50 latency. In other words: Nano must match-or-beat Workers AI on accuracy AND be meaningfully faster; if it does not beat Workers AI, there is no reason to prefer it given the Chrome-flag dependency.
- **Fail**: G2 accuracy ≤ 6/10, OR G2 p50 latency > 500ms, OR G2 regresses (gets wrong) any triple that G1 gets right.
- **Ambiguous**: anything in between — e.g. 7-8/10 accuracy, or latency in the 100–500ms band, or G2 wins on hard cases but loses on an easy one. RESULT.md proposes a follow-up (probably: try DOM summary compression, or a different prompt shape).

## What could surprise us
- Prompt API returning nondeterministic booleans across repeated runs on the same input (would undermine gate reliability independent of accuracy).
- G1 (deterministic `textPresent`) already hitting 9+/10 on this fixture set, making G2 a solution looking for a problem.
- Gemini Nano latency dominated by session warmup (first call ~2s, subsequent calls <50ms), meaning the per-execution cost depends on whether we keep sessions alive across tool calls.

## Integration target
If Pass: graduate G2 into `src/ai/PostconditionGate.ts` (new file, sibling to `src/ai/ScoutAgent.ts` and `src/ai/AnthropicProvider.ts`). Wire it into the DomWorker (future `src/tools/DomWorker.ts`, sibling to `src/tools/Worker.ts`) as the default post-execution verification step. Extend `src/domain/Path.ts` (or the future `src/domain/ToolExecution.ts`) to record `{gate: "g1" | "g2", passed: boolean, latencyMs: number}` on every execution log so exp-011's Directory can aggregate gate-failure rates per tool. Graduation is contingent on exp-009b (Workers AI gate) shipping first as the default. Nano gate graduates only as an OPTIONAL fast path for Chrome users with the flag enabled; it never becomes the only gate.

## Contract interaction
**Consumes** `tool-spec.v0.json`. Specifically reads `tools[i].description` (fed to the Prompt API as intent) and `tools[i].postcondition` (both `kind` and `value`/`pattern`/`target`). Does **not** produce `tool-spec.v0.json`. Treats the CONTRACT as frozen: if a postcondition kind feels insufficient for a triple (e.g. needs "no error banner visible"), the triple gets labeled Ambiguous and a note goes in `BACKLOG.md` — we do not invent new postcondition kinds.

## Out of scope
- Building a full DomWorker or runner — this experiment only evaluates gates against pre-captured DOM snapshots.
- Comparing against Workers AI or any server-side model (that's the companion experiment; this one is the in-tab half only).
- Optimizing the Prompt API prompt shape beyond one reasonable template — prompt engineering is its own rabbit hole.
- Handling multi-turn or streaming Prompt API sessions — one `prompt()` call per gate check.
- Adding a fourth postcondition kind or any CONTRACT changes, even if the data suggests it.
