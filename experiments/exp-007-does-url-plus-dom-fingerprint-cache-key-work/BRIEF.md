# exp-007-does-url-plus-dom-fingerprint-cache-key-work

## Question
Does a fingerprint over (URL, DOM structure) correctly match unchanged pages, miss when the page has changed in a tool-breaking way, and hold stable across users — well enough to key a shared Directory cache?

## Why this question
The Directory's entire amortization story depends on one user's scouted tool spec being reusable by the next user. That only works if we can compute a stable cache key that says "same page, same tools still apply." If every user gets a cache miss, synthesis cost is paid per-user and the Directory is just a leaderboard. If every user gets a false cache hit on a changed page, we hand agents broken tools. This experiment picks the fingerprint strategy that goes into `tool-spec.v0.json`'s `fingerprintStrategy` field and decides whether cross-user sharing is viable at all.

## Method
1. Pick 10 target URLs spanning form-heavy, content-heavy, and app-like pages: `https://news.ycombinator.com/submit`, `https://github.com/login`, `https://www.google.com/`, `https://en.wikipedia.org/wiki/WebMCP` (or a stable article), `https://httpbin.org/forms/post`, `https://www.djangoproject.com/`, `https://stackoverflow.com/questions/ask`, `https://react.dev/learn`, `https://news.ycombinator.com/` (list page), `https://example.com/`.
2. Capture each URL at T0 using `@cloudflare/puppeteer` via Browser Rendering (or a local Puppeteer as fallback): save full rendered HTML, the accessibility tree (`page.accessibility.snapshot()`), and every `<form action=...>` attribute into `captures/T0/<slug>.json`.
3. Obtain a T1 capture for each URL via one of: (a) Wayback Machine snapshot ~7 days prior (`https://web.archive.org/web/2026*/<url>`) for a naturally-drifted sample, or (b) re-capture live and mark drift type as "incidental." Record which mode each URL used.
4. Construct three synthetic mutation sets over T0 captures to simulate known-breakage: M1 rename a form field label ("Email" → "Email address"), M2 remove a submit button, M3 inject a tracking `<script>` and a hidden `<div>` with no user-visible change. Save as `captures/mutated/<slug>-<mX>.json`.
5. Implement four fingerprint strategies as pure functions from capture → `sha256` hex:
   - F1: `sha256(canonical_url)`.
   - F2: `sha256(canonical_url + sorted(unique(form.action for form in doc)))`.
   - F3: `sha256(canonical_url + sorted(unique("<role>:<accessibleName>" for every node with a non-empty accessible name in the AX tree)))`.
   - F4: `sha256(canonical_url + tag_structure_hash)` where `tag_structure_hash` is a depth-first traversal emitting tag names only, no attrs, no text.
6. Compute a 4×(10 URLs × pair-types) matrix of matches, where pair-types are: T0↔T0 (same capture twice, must match), T0↔T1 unchanged (should match), T0↔T1 drifted (ambiguous; record), T0↔M1/M2/M3 (must NOT match for strategies that claim tool-safety).
7. Tabulate for each strategy: false-match rate (fingerprint matches but tools would break) and false-miss rate (fingerprint differs but tools would still work). Target false-match on M1/M2 = 0%. Target false-miss on T0↔T0 = 0%.
8. Write `results.md` with the table, a recommendation for the winner, and a `BACKLOG.md` proposal entry (in `experiments/BACKLOG.md`) suggesting the `fingerprintStrategy` identifier (e.g. `"url+ax-role-name-v1"`) to add to the CONTRACT's allowed list. Do not edit CONTRACT.md.

## Inputs
- 10 URLs listed in Method step 1.
- Browser Rendering binding or local Puppeteer to produce captures.
- Wayback Machine CDX API for T1 drift samples: `https://web.archive.org/cdx/search/cdx?url=<url>&limit=5&from=20260101`.
- No consumption of prior `tool-spec.v0.json` artifacts.

## Outputs
- `captures/T0/*.json`, `captures/T1/*.json`, `captures/mutated/*.json` — raw capture data.
- `fingerprints.ts` — the four strategy implementations, one file, not graduated to `src/`.
- `results.md` — the collision / miss table and per-strategy verdict.
- `RESULT.md` — standard experiment result file (Pass/Fail/Ambiguous, learnings, surprises, graduation recommendation).
- Proposed addition to `experiments/BACKLOG.md` naming the winning `fingerprintStrategy` identifier for CONTRACT adoption.
- Does **not** produce a `tool-spec.v0.json`.

## Kill-by
3 hours. If the capture pipeline alone eats 2h, drop to 5 URLs and 2 strategies (F1, F3) and finish the analysis anyway.

## Pass / Fail / Ambiguous criteria
- **Pass**: at least one strategy achieves 0% false-match across all M1/M2 mutations on all 10 URLs AND ≤10% false-miss on T0↔T0 and on T0↔T1 unchanged (Wayback stable snapshots). That strategy is the recommended `fingerprintStrategy`.
- **Fail**: no strategy clears both bars. Cross-user Directory sharing by fingerprint is not safe as conceived; exp-011 must either add server-side re-validation or shrink scope to per-user caches.
- **Ambiguous**: a strategy clears the false-match bar but false-miss is 10–40%; cache still safe but hit rate may be too low to be worth it. Recommend an A/B in exp-011.

## What could surprise us
- F4 (tag-structure) may false-match on mutation M1 because renaming a label doesn't change tags — which would prove tag-structure alone is tool-unsafe despite being the most intuitive approach.
- F3 (role+name) may false-miss on T0↔T0 because headless browsers compute accessible names non-deterministically for dynamic content (e.g. ARIA live regions injected post-paint).
- A large fraction of real-world T0↔T1 "unchanged" pairs may differ purely due to CSRF tokens, nonces, or A/B test class names — pushing us toward an AX-tree-only strategy even if HTML-level strategies look simpler.

## Integration target
If a strategy passes, it graduates into `src/domain/Fingerprint.ts` as a new named strategy alongside the existing URL+request-pattern hash used for API capture. The strategy name becomes a legal value of `tool-spec.v0.json`'s `fingerprintStrategy` field. Capture-side code lands in `src/services/Browser.ts` (accessibility snapshot plumbing). No changes to `src/tools/Scout.ts` until a DomScout experiment graduates.

## Contract interaction
Neither produces nor consumes `tool-spec.v0.json`. Cares specifically about the `fingerprint` and `fingerprintStrategy` top-level fields: this experiment is what populates them honestly. Output feeds a `BACKLOG.md` proposal to add the winning strategy identifier to the contract's list of allowed strategies; does not edit CONTRACT.md.

## Out of scope
- Synthesizing any tools or emitting `tool-spec.v0.json`.
- Deciding how the Directory stores or indexes fingerprints (that's exp-011).
- Authenticated-page fingerprinting (logged-in views defer to exp-010).
- Shadow DOM and iframe traversal (CONTRACT lists these as v0 non-goals).
- Perceptual / visual-diff fingerprints (screenshots, DOM layout boxes) — staying structural for this experiment.
