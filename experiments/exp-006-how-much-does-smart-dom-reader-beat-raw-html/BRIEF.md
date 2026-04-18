# exp-006-how-much-does-smart-dom-reader-beat-raw-html

## Status: Deferred until exp-001 OR exp-002 passes

This experiment is an OPTIMIZATION question: given that a synthesizer works, what extraction format feeds it most efficiently? If neither exp-001 (Gemini Nano) nor exp-002 (Workers AI) passes, there is no synthesizer to optimize for and this experiment is moot. exp-006 runs ONLY AFTER exp-001 or exp-002 RESULT.md is Pass. Until then, this BRIEF is retained for scope but not executed.

## Question
Decide which DOM extraction mode (raw outerHTML, @mcp-b/smart-dom-reader, or a custom a11y-tree dump) gives the best tokens-in vs tools-emitted vs tools-valid ratio on the exp-001 URL set.

## Why this question
Synthesis cost and quality are both bottlenecked by what we feed the model. Raw `outerHTML` on a modern SPA can be 50k+ tokens of class-soup noise; a well-pruned extraction can be 1/10th the size. If a cheaper extraction produces equal or better tool quality, every downstream experiment (exp-001, exp-002, exp-008) gets faster and cheaper for free. If the cheap extractions drop tools, we've quantified the tradeoff instead of guessing it. This experiment resolves the "what goes into the synthesis prompt?" question once, for everyone.

## Method
1. Reuse the exact 10 URLs from `experiments/exp-001-can-gemini-nano-emit-valid-tool-specs/BRIEF.md` (read that file; if the list isn't fixed yet, pick 10 covering: login form, contact form, search box, checkout-like flow, multi-step form, listing page, table with filters, SPA dashboard, static content page, and a known-noisy site like Amazon or LinkedIn).
2. For each URL, spin up Cloudflare Browser Rendering (reuse `src/services/Browser.ts` patterns; do NOT edit that file) and produce three extractions per URL:
   - **(A) raw**: `document.documentElement.outerHTML` after `networkidle`.
   - **(B) smart**: output of `@mcp-b/smart-dom-reader` (install locally inside the experiment folder; check npm for exact package name and API).
   - **(C) a11y**: a custom walk of the accessibility tree via CDP `Accessibility.getFullAXTree`, flattened to a terse text format (role, name, value, role-relevant attributes only).
3. Tokenize each extraction with `@anthropic-ai/tokenizer` (Claude tokenization, since downstream synthesis is Claude-family). Record `tokens_in` per (url, mode).
4. Feed each of the 30 extractions into the **same** synthesis prompt template (copy the prompt from exp-001; freeze its hash) using **Workers AI** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for determinism and cost. Seed/temperature fixed. Same system prompt, same user prompt template, only the `{{extraction}}` slot varies. Additionally, run ONE of the URLs through a second synthesizer family (if exp-002 chose Llama, use Claude Sonnet; if Nano, use Workers AI) to check that the extraction-mode winner is not a synthesizer-specific artifact. One URL is enough as a sanity check, not a systematic test.
5. Parse each synthesis output as `tool-spec.v0.json`. Record `tools_emitted` (raw count) and `tools_valid` (count that hand-validate against `CONTRACT.md` — correct version, correct DSL verbs, role+name targets, unique snake_case names, valid JSON Schema inputSchema, risk enum, placeholders resolve).
6. Emit `results.csv` with columns: `url, extraction_mode, tokens_in, tools_emitted, tools_valid, synthesis_ms, synthesis_status`.
7. Compute summary table per mode: median tokens, p95 tokens, total tools_emitted, total tools_valid, validity rate (tools_valid / tools_emitted).
8. Write `RESULT.md` with Pass/Fail/Ambiguous and a recommendation sentence: "Feed mode X into synthesis because Y."

## Inputs
- The 10 URLs from exp-001's BRIEF (or the fallback list above if exp-001 hasn't frozen it).
- The synthesis prompt template from exp-001 (copied verbatim, hash pinned in `results.csv` header).
- `tool-spec.v0.json` schema from `experiments/CONTRACT.md`.
- Cloudflare Browser Rendering account + Workers AI binding (both already wired in the unsurf repo).

## Outputs
- `results.csv` — 30 rows (10 URLs × 3 modes) with the columns listed in step 6.
- `summary.md` — per-mode aggregate table and the winning mode.
- `extractions/<url-slug>/{raw.html,smart.txt,a11y.txt}` — archived inputs for reproducibility.
- `specs/<url-slug>/<mode>.json` — raw synthesis outputs (pre-validation).
- `RESULT.md` — Pass/Fail/Ambiguous + one-line graduation recommendation for `src/services/Browser.ts`.
- **Does not** produce `tool-spec.v0.json` as a deliverable; the specs emitted here are diagnostic, not canonical.

## Kill-by
2 hours. If exceeded, dump partial `results.csv` (whatever URLs completed), write `RESULT.md` as Ambiguous with the partial data, and stop.

## Pass / Fail / Ambiguous criteria
- **Pass**: One mode has (a) ≥2× lower median `tokens_in` than another AND (b) `tools_valid` count within 10% of the best mode across all 10 URLs. That mode wins.
- **Fail**: No mode beats raw `outerHTML` on `tools_valid` count and token savings are under 2×. Recommendation: stick with raw.
- **Ambiguous**: Modes differ on different URL types (e.g., smart-dom-reader wins on SPAs but loses on static pages), OR Workers AI synthesis fails (non-JSON output) on >30% of runs, masking the signal. Recommendation: per-URL-type routing or rerun with a different synthesizer.

## What could surprise us
- `smart-dom-reader` strips something load-bearing (e.g., form labels rendered via `aria-labelledby`) and silently kills tools on 2+ URLs even though token count looks great.
- The a11y-tree extraction is *smaller* than smart-dom-reader and produces *better* tools because it's already shaped like what the model needs to emit (role+name targets).
- Raw `outerHTML` wins on tool quality by enough to justify the cost because the model uses visual/layout cues (adjacent text, sibling structure) that pruned extractions discard.

## Integration target
`src/services/Browser.ts` — add an `extractForSynthesis(page, mode)` method returning the winning extraction format. The mode selected here becomes the default; other modes stay available behind a flag for regression testing. No change to `src/services/SchemaInferrer.ts` or `src/tools/Scout.ts`.

## Contract interaction
Consumes the `tool-spec.v0.json` schema for validation only — this experiment hand-validates synthesis outputs against `CONTRACT.md` to score `tools_valid`. It does **not** produce canonical `tool-spec.v0.json` artifacts; the emitted JSONs are measurement instruments, not registry entries. Fields it cares about: `tools[].name` uniqueness, `tools[].dsl[].op` ∈ the six verbs, `tools[].dsl[].target.role`/`name` both present, `tools[].inputSchema` is a valid object schema, `tools[].risk` ∈ {low,medium,high}.

## Out of scope
- Changing the synthesis prompt itself (exp-001/exp-002 own that).
- Evaluating whether emitted tools actually *execute* correctly (exp-003 owns that; "valid" here means "conforms to contract").
- Comparing synthesizers — only Workers AI Llama is used here, precisely to isolate the extraction-mode variable.
- Fingerprinting or caching the extractions (exp-007 owns that).
- Building a production extractor; this experiment outputs a decision, not shippable code.
