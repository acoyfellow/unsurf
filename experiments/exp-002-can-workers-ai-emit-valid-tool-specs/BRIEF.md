# exp-002-can-workers-ai-emit-valid-tool-specs

## Question
Determine whether a Workers AI model (Llama 3.3 70B Instruct or Qwen 2.5 Coder 32B) called via Cloudflare AI Gateway with `responseFormat: { type: "json_schema" }` can emit `tool-spec.v0.json` documents that both validate against the CONTRACT schema AND capture strictly more real, executable actions than Gemini Nano (exp-001) on the same 10 URLs.

## Why this question
exp-001 establishes the cost floor (free, local, zero-latency inference via Chrome's Prompt API). This experiment establishes the quality ceiling on a path unsurf can actually ship today: AI Gateway is already wired into the Worker, billing is predictable, and structured outputs are first-class. Answering this tells us whether the production synthesizer should be Workers-AI-primary-with-Nano-fallback, Nano-primary-with-Workers-AI-fallback, or Workers-AI-only. It also rules out "we need Anthropic/OpenAI in the hot path" if a CF-resident model is good enough, which keeps the hosted instance cheap and the self-host story single-vendor.

## Method
1. Create `experiments/exp-002-can-workers-ai-emit-valid-tool-specs/run.ts` — a standalone Bun/TS script, no unsurf imports, no Effect. Keep it flat.
2. Hardcode the same 10 target URLs used by exp-001. Pull them from `experiments/exp-001-can-gemini-nano-emit-valid-tool-specs/urls.json` if it exists; otherwise define inline and copy to `urls.json` here for reproducibility. The set should include: a contact form, a login page, a search box, a signup form, a newsletter subscribe widget, a product-page "add to cart" button, a comment form, and three gnarlier real-SaaS targets that require cookies from a logged-in session: (a) a logged-in Linear view (e.g. `https://linear.app/<workspace>/team/<TEAM>/active`), (b) a logged-in Gmail inbox (`https://mail.google.com/mail/u/0/#inbox`), and (c) a logged-in Shopify admin products page (`https://admin.shopify.com/store/<store>/products`).
3. For each URL: `fetch(url)` with a desktop User-Agent; capture HTML as-is (no headless browser, no JS execution — that's exp-006's concern). Record HTML byte size. For (a), (b), (c), supply cookies via a Cookie header from the test users browser profile. If cookies are unavailable, substitute the original URLs and mark RESULT.md as partial regarding real-SaaS coverage.
4. Pass the HTML through a stub `smartDomReader(html: string): string` that: strips `<script>`, `<style>`, `<svg>`, comments; keeps `role`, `aria-*`, `name`, `placeholder`, `type`, `href`, visible text; truncates to 32k chars. This is a deliberate stub — exp-006 owns the real extractor.
5. Write the JSON Schema for `tool-spec.v0.json` inline in the script (hand-translated from `experiments/CONTRACT.md`). Include `version`, `url`, `fingerprint`, `fingerprintStrategy`, `synthesizedAt`, `synthesizer`, `tools[]` with the full `DslOp` union and `Target` enum. Fingerprint can be `sha256(url)` for this experiment; real fingerprinting is exp-007.
6. For each URL, make one call per model against AI Gateway: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and `@cf/qwen/qwen2.5-coder-32b-instruct`. Use a single shared system prompt explaining the task + the six-verb DSL + the no-CSS-selectors rule + `risk` rubric. User message contains the URL and the cleaned DOM. Request `response_format: { type: "json_schema", json_schema: <inline schema> }`. Temperature 0.2, max_tokens 4096.
7. Persist each raw response to `experiments/exp-002-.../out/<model>/<url-slug>.json`. Persist a per-URL metrics row to `out/metrics.csv`: `url, model, prompt_tokens, completion_tokens, latency_ms, http_status, schema_valid (bool), tool_count, nontrivial_tool_count, schema_errors[]`.
8. "Nontrivial" = tool has ≥2 DSL ops, at least one non-`read` op, all targets resolve role from the CONTRACT's role enum, `inputSchema` has ≥1 property, and every `{{placeholder}}` in `dsl.value` fields is declared in `inputSchema.properties`.
9. After all URLs: load exp-001's RESULT.md / metrics if present. Emit `COMPARISON.md` with a table — per-URL rows, columns `Nano tools / Nano nontrivial / Llama tools / Llama nontrivial / Qwen tools / Qwen nontrivial`, totals at the bottom. If exp-001 hasn't finished, note that and compare only within exp-002.
10. Write `RESULT.md` with Pass/Fail/Ambiguous, cost per URL (CF's published $/1M tokens times observed token counts), and a one-paragraph recommendation on primary-vs-fallback ordering.
11. Comparison baseline: on the same 10 URLs, also synthesize with Anthropic Claude Sonnet via its structured-output API (same prompt, same schema). Record: tools_emitted, tools_valid, prompt_tokens, completion_tokens, latency_ms. RESULT.md must include a one-row comparison of each Workers AI model vs Claude Sonnet. If no Anthropic key, state that Anthropic-as-ceiling is untested and Pass here is against Llama/Qwen alone.

## Inputs
- The 10 URLs (shared with exp-001; copied into `urls.json` in this folder).
- `experiments/CONTRACT.md` — schema hand-translated into the script.
- Cloudflare account + AI Gateway binding. Gateway name and API key via `.env.local` (do not commit).
- exp-001's outputs if available, for the comparison table. Optional — not a blocker.

## Outputs
- `urls.json` — frozen URL list.
- `run.ts` — the script.
- `out/llama/<slug>.json`, `out/qwen/<slug>.json` — raw `tool-spec.v0.json` candidates (20 files).
- `out/metrics.csv` — per-call metrics.
- `COMPARISON.md` — side-by-side table vs exp-001.
- `RESULT.md` — Pass/Fail/Ambiguous + recommendation.
- **Produces `tool-spec.v0.json`** samples. 10×2 = 20 specs. Downstream experiments (exp-003 DSL runner, exp-005 role+name survival, exp-011 directory) can consume them.

## Kill-by
2 hours wall-clock from script start. If exceeded, checkpoint whatever specs and metrics exist, skip COMPARISON.md if needed, and write RESULT.md with partial data.

## Pass / Fail / Ambiguous criteria
- **Pass**: For at least one of the two models, ≥8/10 URLs produce a spec that (a) validates against the v0 schema and (b) has ≥1 nontrivial tool, AND that model's total nontrivial-tool count is strictly greater than Nano's from exp-001 (or, if exp-001 is unavailable, ≥12 nontrivial tools total across 10 URLs).
- **Fail**: Both models produce <6/10 valid specs, OR neither exceeds Nano on nontrivial tool count when exp-001 results are available.
- **Ambiguous**: 6–7/10 valid for the best model, or schema-valid but semantically thin (most tools are single-op `read` fallbacks), or AI Gateway `responseFormat` enforcement is unreliable (>20% of responses need repair to parse).
- Pass is thesis-informative but only becomes thesis-sufficient when exp-012 benchmarks end-to-end tokens and latency. A spec that validates at synthesis time but performs worse than agent-browser at execution time is not a Pass in the branch-level sense (see THESIS.md).

## What could surprise us
- Qwen 2.5 Coder 32B beats Llama 3.3 70B on this specifically because the task is really "emit JSON matching a schema," which is a coding task.
- `response_format: json_schema` at the Gateway does not actually enforce the `DslOp` discriminated union and models invent a seventh verb (`wait`, `hover`, `scroll`). If common, this is evidence for exp-003's DSL interpreter to fail closed on unknown ops and log the verb to BACKLOG.md.
- Token cost per URL is dominated by the cleaned DOM, not the schema or prompt — meaning exp-006 (smart DOM reader) is on the critical path for Workers AI cost, not just latency.

## Integration target
If Pass: graduate the script into `src/ai/WorkersAISynthesizer.ts` as a sibling to `src/ai/AnthropicProvider.ts`, exposing an Effect service `WorkersAISynthesizer` that consumes cleaned DOM and emits `tool-spec.v0.json`. `src/tools/Scout.ts` gains a synthesis step that calls it for DOM-level capture. The JSON Schema graduates to `experiments/contract/tool-spec.v0.schema.ts` (authoritative Zod) once exp-003 needs it — we hand off our inline version. Provenance (`synthesizer.name`, `synthesizer.model`, `synthesizer.promptHash`) flows into `src/domain/Fingerprint.ts` for directory cache keys. exp-002s Pass is thesis-critical only insofar as SOME synthesizer must pass; if exp-001 (Nano) also passes, either can be the primary backend. If both fail, the branch goes Red (see THESIS.md).

## Contract interaction
Produces `tool-spec.v0.json`. Does not consume any prior spec. Fields this experiment cares about specifically: the full `tools[].dsl` array (primary quality signal), `tools[].inputSchema` (must be a valid JSON Schema object with placeholder coverage), `tools[].risk` (must be honestly labeled — a `submit` with risk:`low` is a red flag for the model's reliability), `synthesizer.model` and `synthesizer.promptHash` (so exp-011 can diff specs across synthesizers). Ignores `fingerprint`/`fingerprintStrategy` beyond stubbing — that's exp-007.

## Out of scope
- Running the DSL. Specs are produced, not executed. exp-003 owns execution.
- Headless browser rendering of the target URLs. Raw `fetch()` only; JS-heavy sites may produce thin specs and that's a real signal, not a bug to fix here.
- Prompt iteration beyond two attempts per model. We are measuring models under one reasonable prompt, not prompt-engineering to pass.
- Calling Anthropic, OpenAI, or Gemini Pro. Cloud-resident-on-Cloudflare only; cross-vendor comparison is a future experiment.
- Building a real `smartDomReader`. Stub only. exp-006 is the dedicated experiment for DOM extraction quality.
