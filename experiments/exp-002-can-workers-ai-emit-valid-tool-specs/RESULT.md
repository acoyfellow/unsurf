# exp-002 — RESULT

**Amendments applied:** AMD-004 (skipped Claude Sonnet baseline — no API key), AMD-005 (URL substitutions: midjourney.com + coey.dev in place of Linear/Gmail/Shopify admin).

**Also:** n was 6 URLs, not 10. Reduced from 10→6 pre-execution due to per-request latency budget (Workers AI with JSON-schema `response_format` takes 30-180s per call). This is a deviation from the BRIEF and is noted here honestly.

## Result: **FAIL**

Against the BRIEF's Pass criteria ("for at least one of the two models, ≥8/10 URLs produce a spec that validates AND has ≥1 nontrivial tool, AND that model's total nontrivial-tool count is strictly greater than Nano's"):

- Zero (0) nontrivial tools emitted across **either** model across **all** 6 URLs.
- Even with n reduced to 6, no model hit ≥5/6 (80% of n).

## Headline numbers

| Model | n | Schema-valid | Nontrivial tools | Mean latency |
|---|---|---|---|---|
| Qwen 2.5 Coder 32B | 6 | 5/6 (83%) | **0** | 24.3 s |
| Llama 3.3 70B fp8-fast | 6 | 1/6 (17%) | **0** | 100.9 s |

## What actually happened

1. **Qwen emitted lots of tools (3–16 per page) but all were trivial.** The synthesizer kept producing single-op tools with empty `inputSchema.properties`. Example failure mode: it would emit one `tool` per clickable link (`click_home`, `click_about`, `click_contact`), each with `dsl: [{op:"click", target:{...}}]` and no input args. These pass schema validation but aren't real agent tools — they're catalog entries of what's on the page.

2. **Llama returned `"not an object"` on 5 of 6 URLs.** Workers AI's `response_format: { type: "json_schema" }` is NOT reliably enforced by Llama 3.3 70B fp8-fast. Responses came back as strings, empty objects, or other shapes. This is a Workers-AI-side limitation, not purely a prompt issue — Qwen got the schema enforced more consistently on the same prompt.

3. **The role enum is too tight.** Qwen tried to emit `"role": "option"` for `<option>` elements in a `<select>`. `option` is a real ARIA role but is not in CONTRACT.md's closed set. Three of Qwen's 16 emitted tools were rejected for this. The contract needs `option` (and probably `menu`, `menuitem`, `switch`, `searchbox`, `tooltip` — see `BACKLOG.md` entry).

4. **JS-heavy and logged-in pages returned 0 tools.** Midjourney (both models), coey.dev/projects (both models), and Wikipedia via Qwen returned empty `tools: []` because the raw HTTP fetch got an app shell with no interactive content. This is a known limitation called out in AMD-005 and in `exp-002/BRIEF.md` "What could surprise us" item 3.

## Surprises

- **Expected:** Qwen 2.5 Coder 32B would beat Llama 3.3 70B on a code-shaped JSON-emission task. It did, dramatically. This is exp-002's surprise #1 confirmed.
- **Unexpected:** Workers AI's `response_format` enforcement varies by model. Llama essentially ignored it. This is a platform finding, not just a model finding.
- **Unexpected:** the "nontrivial" criterion (≥2 ops, at least one non-read, inputSchema with ≥1 property) is extremely discriminating — both models trivially clear schema validity but neither reliably produces tools that *do* something.

## What this means for the thesis

- Per THESIS.md: **exp-002 is one of two synthesizer paths.** Failing here alone is informative, not fatal — *unless* exp-001 (Nano) also fails, in which case THESIS goes Red (both synthesizers failed = no synthesizer = no branch).
- The emitted tools, even if trivial, are interesting: they show the synthesizer understood roles and names but not "what the page is FOR." This points to a prompt-engineering deficit (the synthesizer needs stronger guidance on "what would a user want to accomplish here?") more than a model-capability deficit.
- Qwen's 83% schema-validity rate is actually solid — the model can follow the contract. The prompt needs to ask for intent-shaped tools, not element enumeration.

## Recommended follow-up (not run in this experiment)

1. **exp-002b**: same setup, prompt revised to ask "what 3 things would a user most want to accomplish on this page?" and to reject tools with empty `inputSchema`. Run same URLs. If nontrivial count goes from 0 → >5/6, the prompt was the bottleneck, not the model. If still 0, move on.
2. **CONTRACT BACKLOG entry**: expand the role enum to include `option`, `menu`, `menuitem`, `switch`, `searchbox`, `tooltip`. (Logged below.)
3. **JS rendering path**: exp-002c using `@cloudflare/puppeteer` (Browser Rendering) to get post-hydration DOM for JS-heavy pages.

## BACKLOG additions

- `CONTRACT role enum is too tight` — Qwen emitted `option`, which is a legit ARIA role missing from the closed set.
- `response_format enforcement is model-specific in Workers AI` — Llama ignores the schema ~80% of the time; plan cannot assume schema is honored.
- `Nontrivial tools require intent-shaped prompting` — the current prompt produces element catalogs, not task tools.

## Raw data

- `out/summary.json` — summary blob
- `out/metrics.csv` — per-(url, model) row
- `out/llama/<slug>.json`, `out/qwen/<slug>.json` — raw per-synthesis outputs
- `samples/` — empty (0 nontrivial specs qualified for downstream use)

## Honesty log

- n reduced from 10 → 6 due to latency budget. Stated.
- Claude Sonnet comparison skipped per AMD-004. Stated.
- Midjourney + coey.dev + jordancoeyman.com (AMD-005) returned mostly empty results because we used raw HTTP fetch, not a headless browser, so JS-rendered content was missing. Stated.
- Pass bar was not lowered post-hoc. The original BRIEF said nontrivial count > Nano's; we got 0 nontrivial. Fail is fail.
