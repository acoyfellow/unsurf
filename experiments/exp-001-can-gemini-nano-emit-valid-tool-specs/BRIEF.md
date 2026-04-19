# exp-001-can-gemini-nano-emit-valid-tool-specs

## Question
Given a raw page extraction, can Chrome's in-tab Prompt API (`navigator.LanguageModel`, Gemini Nano) emit a `tool-spec.v0.json` that validates against `CONTRACT.md`?

## Why this question
Nano is free, local, and runs inside the user's browser tab — if it can produce valid tool specs for common forms, unsurf gets a zero-cost synthesizer tier that never touches a server. Answering this rules in (or out) the "client-side-only WebMCP capture" path and tells us whether exp-002 (Workers AI) is a fallback or the primary path. It also bounds what prompt size / schema complexity Nano can actually sustain, which every later synthesis experiment inherits. Because Gemini Nano requires a Chrome flag (chrome://flags/#prompt-api-for-gemini-nano) and is Canary/Dev-channel only, a Pass here DOES NOT IMPLY ship-readiness — this experiment tests a future optimization, not the ship path. The ship path uses exp-002 (Workers AI).

## Method
1. Create `index.html` inside this folder. No build step, no framework. Load in Chrome Canary/Dev with `chrome://flags/#prompt-api-for-gemini-nano` and `#optimization-guide-on-device-model` enabled; confirm `'LanguageModel' in self` before proceeding.
2. UI: one `<textarea id="html">` (paste `document.documentElement.outerHTML` from a target page), one `<input id="url">`, one `<button id="run">Synthesize</button>`, one `<pre id="out">` for emitted JSON, one `<pre id="errs">` for validation errors, one `<span id="latency">` for ms.
3. Hardcode the full `tool-spec.v0.json` JSON Schema (derived verbatim from `experiments/CONTRACT.md`) as `toolSpecJsonSchema` in the page. Include: the six DSL verbs, the Target role enum, the three Postcondition kinds, the risk enum.
4. On click: `await LanguageModel.create({ systemPrompt })` then `session.prompt(userPrompt, { responseConstraint: toolSpecJsonSchema })`. System prompt instructs: "You are a WebMCP synthesizer. Given the outerHTML of a single page, emit a tool-spec.v0.json describing the actionable tools on that page. Use only role+name targets. Drop any tool whose target you cannot determine. Use the six DSL verbs exactly. Label risk honestly per the rubric." Include the rubric inline.
5. User prompt: `"url: " + url + "\n\nouterHTML:\n" + html` (truncated to Nano's input token window — measure and record the cap).
6. Validate emitted JSON with an in-page Ajv 2020 instance (loaded via CDN `<script>`) against `toolSpecJsonSchema`. Record: parseable? schema-valid? all placeholders in `dsl.value` declared in `inputSchema.properties`? all target roles in enum? all tool names unique + snake_case?
7. Run against 10 target URLs, capturing outerHTML via DevTools console (`copy(document.documentElement.outerHTML)`):
   - contact form: `https://www.djangoproject.com/contact/foundation/`
   - search form: `https://duckduckgo.com/`
   - login form: `https://github.com/login`
   - comment form: any Hacker News item page, e.g. `https://news.ycombinator.com/item?id=1`
   - newsletter signup: `https://buttondown.com/`
   - a Shopify admin products page: `https://admin.shopify.com/store/<any-dev-store>/products` (requires login)
   - simple e-commerce product page: `https://www.saucedemo.com/` (post-login product listing)
   - logged-in Linear dashboard: `https://linear.app/<user-workspace>/inbox` (user must be logged in in the test Chrome profile)
   - Google Form: create a throwaway 3-field form and paste its public URL
   - logged-in Gmail compose view: `https://mail.google.com/mail/u/0/#inbox?compose=new`
   Note: URLs (a), (b), (c) require a logged-in test Chrome profile. If login is unavailable, substitute with the original list and mark RESULT.md as ambiguous regarding real-SaaS coverage.
8. For each URL record in `results.json` inside this folder: url, html_byte_count, html_truncated (bool), latency_ms, parse_ok, schema_valid, semantic_valid (placeholder check), tool_count, risk_distribution, raw_output (first 4 KB), validation_errors.
9. Save each successfully validated spec as `samples/<slug>.tool-spec.v0.json`. These are artifacts for exp-003 and exp-004 to consume.
10. Fast-fail gate at 30 minutes: if Nano cannot produce parseable JSON for *any* of the three simplest forms (DuckDuckGo search, Buttondown, contact form), stop and write `RESULT.md` as Fail.
11. Comparison baseline: for the same 10 URLs, ALSO run synthesis through OpenAI GPT-4o-mini via its structured-output API (temperature 0, same system prompt). Record the same per-URL metrics. RESULT.md must report a one-row comparison table: Nano vs GPT-4o-mini on tools_valid count and synthesis_latency. This is not a gating comparison; it is context. Skip this step only if no OpenAI key is available — and state that explicitly.

## Inputs
- `experiments/CONTRACT.md` (schema source of truth).
- 10 target URLs listed above + pasted outerHTML for each.
- Chrome with Prompt API flags enabled; Gemini Nano model downloaded on-device.
- Ajv 2020 (CDN, no install).

## Outputs
- `experiments/exp-001-.../index.html` — the standalone harness.
- `experiments/exp-001-.../results.json` — per-URL run data (schema in step 8).
- `experiments/exp-001-.../samples/*.tool-spec.v0.json` — validated specs. **These are the produced tool-spec.v0.json artifacts.**
- `experiments/exp-001-.../RESULT.md` — Pass/Fail/Ambiguous + learnings + graduation recommendation.
- Decision: is Nano a viable synthesizer tier, or relegated to a toy?

## Kill-by
3 hours. 30-minute fast-fail if no parseable JSON on three simplest forms. When kill-by hits, write `RESULT.md` with whatever samples exist.

## Pass / Fail / Ambiguous criteria
- **Pass** = ≥8/10 URLs emit JSON that (a) parses, (b) validates against the v0 JSON Schema, (c) has no undeclared placeholders, AND median synthesis latency <10 s per page.
- **Fail** = ≤4/10 URLs validate, OR fast-fail gate trips, OR Nano refuses structured output on input sizes <20 KB.
- **Ambiguous** = 5–7/10 validate, OR validates but all tools are `low`-risk read-only (Nano plays it safe and emits nothing actionable), OR latency >30 s median.

Pass here is informative, NOT thesis-gating (see THESIS.md). Graduation to src/ai/ requires exp-012 (benchmark) to show end-to-end value with the winning synthesizer — this experiment alone does not justify graduation.

## What could surprise us
- Nano's `responseConstraint` silently truncates the schema and emits ops not in the six-verb set — revealing that Nano's structured-output mode is more advisory than enforcing.
- Input token window is tight enough (<8 K tokens effective) that raw outerHTML has to be pre-reduced before Nano sees it, which means exp-006 (smart DOM reader) is a *prerequisite*, not an optimization.
- Nano consistently emits valid specs for simple forms but hallucinates accessible names not present in the DOM, making specs that pass schema validation but fail execution in exp-003 — schema-valid ≠ runnable.

## Integration target
If Pass: graduates to `src/ai/GeminiNanoSynthesizer.ts`, sibling to `src/ai/ScoutAgent.ts` and `src/ai/AnthropicProvider.ts`. Would be invoked from a new `src/tools/DomScout.ts` (future, from exp-003's runner side). Since Nano is desktop-Chrome-only and behind flags, this is the free-fast tier, not the quality tier — `src/ai/AnthropicProvider.ts` or exp-002's Workers AI stays the default synthesizer for the hosted path. If Fail: skip and lean on exp-002. Graduation path: Pass here becomes an OPTIONAL backend registered alongside the Workers AI synthesizer from exp-002; it never becomes the sole synthesizer because the Chrome-flag dependency is incompatible with a self-hostable product.

## Contract interaction
**Produces** `tool-spec.v0.json`. Cares specifically about: `tools[].dsl` (must be restricted to the six verbs), `tools[].dsl[].target` (role must be in the closed enum, name must be plausibly taken from the HTML), `tools[].inputSchema` ↔ placeholder consistency, `tools[].risk` (Nano must label honestly), and `synthesizer.{name, model, promptHash}` (this experiment sets `name: "exp-001-gemini-nano"`, `model: "gemini-nano"`, and a SHA-256 of the exact system+user prompt). Does not consume any prior contract artifacts.

## Out of scope
- Executing the emitted DSL. That is exp-003. No DOM writes from this harness.
- Smart DOM pre-reduction (strip script tags, collapse whitespace, extract only interactive subtree). That is exp-006; here we feed raw outerHTML and measure where it breaks.
- DOM-structure fingerprinting beyond a SHA-256 of the input HTML for provenance. Real fingerprinting is exp-007.
- Any server-side call, Workers AI, or Anthropic fallback. exp-002 owns the server-side synthesizer comparison.
- Prompt-injection hardening. exp-008 owns adversarial inputs; this experiment uses benign public pages only.
