# BACKLOG

Parking lot for questions and ideas that came up during experiments but are **out of scope for the experiment discovering them**.

## How to use this file

When running an experiment, if you notice something interesting that is *not* your experiment's question, add it here and keep going. Do not pursue it.

Format per entry:

```
## <short title>

- Found during: exp-NNN-<slug>
- Date: YYYY-MM-DD
- Category: schema | runner | synthesizer | directory | security | selectors | fingerprinting | benchmark | other
- Question: <one sentence>
- Why it matters: <one sentence>
- Proposed shape: <one sentence, or "unknown">
```

Keep entries terse. This is a lead list, not a design doc.

---

## (seed) v1 of tool-spec schema

- Found during: scaffolding
- Date: 2026-04-18
- Category: schema
- Question: When we need multi-page flows, streaming tools, or confidence scores, what does `tool-spec.v1.json` look like?
- Why it matters: v0 is deliberately thin. v1 is when real SaaS sites need coverage.
- Proposed shape: unknown — wait for three experiments to want the same thing.

## (seed) Headless synthesis vs in-tab synthesis

- Found during: scaffolding
- Date: 2026-04-18
- Category: synthesizer
- Question: Does the synthesizer live in Browser Rendering (server-side, for any client), in a Chrome extension (user's real browser, inherits auth), or both?
- Why it matters: Business model splits. Server-side = Workers AI spend. Client-side = free but only works when user has Chrome.
- Proposed shape: both; directory caches the server-side, extension does on-demand for unseen pages.

---

## CONTRACT role enum is too tight

- Found during: exp-002
- Date: 2026-04-18
- Category: schema
- Question: Should CONTRACT.md's Target.role enum include `option`, `menu`, `menuitem`, `switch`, `searchbox`, `tooltip` (all legitimate ARIA roles that appear in real pages)?
- Why it matters: Qwen emitted `option` for `<option>` elements inside `<select>`; the synthesizer was correct and the CONTRACT was wrong.
- Proposed shape: additive expansion of the enum; tool-spec.v0.json remains backward-compatible; no role renames.

## Workers AI response_format JSON-schema enforcement varies by model

- Found during: exp-002
- Date: 2026-04-18
- Category: synthesizer
- Question: Why does Llama 3.3 70B fp8-fast ignore `response_format: { type: "json_schema" }` ~80% of the time while Qwen 2.5 Coder 32B honors it 83% of the time on the same prompt?
- Why it matters: If the runner assumes the schema is honored, it will crash on Llama. If the runner always validates + repairs, that's a latency tax. Either way this is a platform-level finding worth escalating to the Workers AI team.
- Proposed shape: (a) run `exp-002b` to see if prompt tweaks close the gap; (b) file an issue with Workers AI re: fp8-fast JSON schema compliance.

## Synthesizer produces element catalogs, not task tools

- Found during: exp-002
- Date: 2026-04-18
- Category: synthesizer
- Question: When the prompt asks "emit tools for this page," the model emits one tool per clickable element. The signal we actually want is "emit tools for the 3-5 things a user would want to accomplish here." Can prompt engineering alone produce intent-shaped tools at >50% nontrivial rate?
- Why it matters: Trivial tools pass schema validation but fail the product test (an agent calling `click_home` is not useful). This may be the single biggest synthesis-quality lever.
- Proposed shape: exp-002b with revised prompt emphasizing user-intent and reject-if-trivial, same URL set, same models, comparable metrics.

## JS-rendered pages return empty tool specs via raw fetch

- Found during: exp-002
- Date: 2026-04-18
- Category: synthesizer / infra
- Question: Midjourney/Wikipedia/coey.dev returned app shells via `fetch()` — how much does Browser-Rendering-backed post-hydration DOM improve nontrivial-tool counts?
- Why it matters: If we can't test the synthesizer on modern SPAs, the whole thesis only works for server-rendered pages.
- Proposed shape: exp-002c with @cloudflare/puppeteer rendering the page fully before passing to the synthesizer. Run same URLs. Compare.
