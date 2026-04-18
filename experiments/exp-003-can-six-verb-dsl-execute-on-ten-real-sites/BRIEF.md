# exp-003-can-six-verb-dsl-execute-on-ten-real-sites

## Question
Can the 6-verb DSL (click/fill/select/check/submit/read) with role+name targets execute hand-written `tool-spec.v0.json` files against 10 real webpages without breaking?

## Why this question
This validates the CONTRACT's load-bearing assumption: that six verbs plus accessibility-tree targeting is sufficient to express real page-level actions. Using hand-written specs eliminates the LLM synthesizer as a variable — if the DSL fails here, no synthesizer experiment (exp-001, exp-002) matters. A pass unblocks every downstream experiment that consumes `tool-spec.v0.json`. A fail tells us exactly which verb or target model is underspecified before we build the runner for real.

## Method
1. Create `runner.ts` in this folder: a Node + TypeScript script using `puppeteer` (not `@cloudflare/puppeteer` — we want local Chrome, not Workers Browser Rendering, for iteration speed). Install locally in `exp-003/`, do not touch root `package.json`.
2. Implement a `SelectorResolver` that, given a `Target` (`role`, `name`, optional `nth`), resolves to a `puppeteer.ElementHandle` by querying Chrome's accessibility tree via `page.accessibility.snapshot({ interestingOnly: false })`, then mapping AX nodes back to DOM nodes via `ElementHandle` lookup. Case-insensitive exact match on accessible name. Fallback: `aria-label`, `aria-labelledby`, then semantic role inference (`<button>` → `button`, `<input type=text>` → `textbox`, etc.). No CSS, no XPath.
3. Implement an executor for all six verbs per CONTRACT.md §DslOp. `submit` dispatches a form submit without clicking a button. `read` populates a return object keyed by op index.
4. Hand-write 10 `tool-spec.v0.json` files in `specs/`, one per URL. Each must have at least one non-`read` verb. Mix of page types:
   - `https://httpbin.org/forms/post` (classic HTML form — baseline)
   - `https://www.wikipedia.org/` (search box + language combobox)
   - `https://duckduckgo.com/` (search, SPA-ish)
   - a Shopify admin page: `https://admin.shopify.com/store/<any-dev-store>/products` (requires login)
   - a logged-in Gmail inbox view: `https://mail.google.com/mail/u/0/#inbox` (requires cookie transfer from logged-in session)
   - `https://react.dev/` (React SPA — tests rerender survival lightly)
   - A TodoMVC React app: `https://todomvc.com/examples/react/dist/` (React SPA, fill + check + read)
   - A Shadow-DOM site: `https://www.youtube.com/` (header search — Polymer/Shadow DOM)
   - `https://github.com/login` (fill-only, do NOT submit — risk=high gate test)
   - a logged-in Linear workspace: `https://linear.app/<user-workspace>/inbox`

   If any of these cannot be logged in for the experiment run, substitute and mark RESULT.md as partial regarding SaaS coverage.
5. For each spec: launch fresh browser context, navigate, execute every op in order, capture per-op result: `ok | resolver_failed | action_failed | postcondition_failed`, with error message and which `Target` failed.
6. Write `results.json` (machine-readable matrix: site × op → status) and `RESULT.md` (human summary).
7. Compute per-verb failure rate across all 10 sites. Flag any verb > 20%.
8. For Shadow DOM (YouTube) and React SPA (TodoMVC, react.dev), log separately whether resolver pierced Shadow roots and whether targets survived hydration (wait strategy: `networkidle2` + 500ms before resolving).
9. Disambiguation stress test. Hand-author ONE additional spec against a page with known role+name collisions (e.g., a GitHub issues page with many buttons named Close or a Gmail inbox with many Delete buttons). The spec must use target.nth to disambiguate. Record: did nth=N resolve to a stable element across two runs? Did the element identity drift? This is not a gating test; it is the fixture for the nth-stability question flagged in the What could surprise us section.
10. Subsume exp-005: because this experiment already runs on React SPAs (react.dev, TodoMVC) and a Shadow-DOM site (YouTube), record observations about role+name survival across rerenders in results.json under a new column `rerender_observations: string[]`. This folds the exp-005 question into exp-003s data set. exp-005 remains as the deep-dive if this sampling is inconclusive.
11. Incumbent comparison. Pick ONE spec and rewrite it as a Playwright script using the full Playwright action surface (25+ actions). Log whether Playwright requires ops NOT in the 6-verb DSL. This is one spec one comparison, not a systematic test — it is the reality check that our DSL is not absurdly narrow.

## Inputs
- CONTRACT.md §DslOp, §Target, §Postcondition (schema verbatim).
- 10 hand-written `tool-spec.v0.json` files authored in this experiment (in `specs/`).
- The 10 live URLs listed above.

## Outputs
- `specs/*.json` — 10 hand-written tool specs (consumes the contract, does not produce synthesized ones).
- `runner.ts` + `resolver.ts` — throwaway implementation scoped to this folder.
- `results.json` — matrix of `{site, toolName, opIndex, op, status, error?}`.
- `RESULT.md` — Pass/Fail/Ambiguous verdict, per-verb failure rates, graduation recommendation for `src/tools/DomWorker.ts` and `src/services/SelectorResolver.ts`.
- BACKLOG.md entries for any verb with > 20% real-world failure (candidate 7th verb or spec v1 change) and for any Target fields that felt missing.

## Kill-by
4 hours. At T+4h, write RESULT.md with whatever sites and verbs are covered and stop, even if mid-site.

## Pass / Fail / Ambiguous criteria
- **Pass**: ≥ 8 / 10 sites execute every non-`submit` op successfully (resolver finds target, action fires, no thrown errors). Every verb has failure rate ≤ 20% across the matrix. Postconditions, when present, evaluate correctly.
- **Fail**: < 6 / 10 sites complete, OR any single verb has > 40% failure rate, OR the resolver cannot handle Shadow DOM *and* React SPA at all (both must work for at least one site each).
- **Ambiguous**: 6 or 7 / 10 sites pass, or exactly one verb sits in the 20–40% failure band. Requires a judgement call in RESULT.md about whether to graduate, iterate the DSL, or escalate to spec v1.

This experiment is THESIS-GATING. Failure kills the branch (see THESIS.md). Post-result, open a BACKLOG.md entry for any verb with >20% real-world failure and for any Target field that felt missing; do not edit CONTRACT.md retroactively.

## What could surprise us
- `submit` turns out to be redundant — `click` on the submit button works everywhere and `form.submit()` dispatches bypass client-side validation so often that it's worse.
- Role+name alone is insufficient for disambiguating lists of identical items (e.g., 10 "Delete" buttons in a table) and `nth` isn't stable across renders — suggesting a 7th field on Target, not a 7th verb.
- Shadow DOM "just works" via `page.accessibility.snapshot` because AX tree is flat, making piercing a non-problem — which would collapse a whole class of feared complications.

## Integration target
If Pass or graduates-with-caveats:
- `runner.ts` → `src/tools/DomWorker.ts` (sibling to `src/tools/Worker.ts`).
- `resolver.ts` → `src/services/SelectorResolver.ts` (new Effect service; should mirror the patterns in `src/services/Browser.ts`).
- Eventually consumed by a `DomScout` in `src/tools/` (different experiment) and by the Directory in `src/services/Directory.ts` to execute cached tool specs.
- Does NOT touch `src/domain/Fingerprint.ts` — that's exp-007's concern.

As a thesis-gate, Pass unlocks graduation of src/tools/DomWorker.ts and src/services/SelectorResolver.ts. Fail triggers a branch post-mortem with RESULT.md summarizing which ops/targets/sites broke.

## Contract interaction
**Consumes** `tool-spec.v0.json`. Does not produce any. Fields this experiment cares about specifically:
- `tools[i].dsl[j].op` — all six verbs exercised.
- `tools[i].dsl[j].target.role` + `target.name` + `target.nth` — the resolver's entire contract.
- `tools[i].dsl[j].value` with `{{placeholder}}` substitution from `inputSchema`-validated args.
- `tools[i].postcondition` — all three kinds exercised at least once across the 10 specs.
- `tools[i].risk` — `high` specs (the GitHub login) must gate on HITL confirmation before `submit`; verify the gate fires. `version` must be `"v0"` or runner rejects.
- Does NOT exercise `synthesizer.*` or `fingerprint*` fields — those are stamped but unread here.

## Out of scope
- Synthesizing specs from an LLM (that's exp-001 / exp-002).
- Fingerprinting pages or caching specs by URL (exp-007).
- Multi-page flows across navigations — CONTRACT §Non-goals says one tool = one page state; honor it.
- Authentication beyond whatever the fresh browser context has (none). Don't actually submit GitHub login.
- Building an Effect service layer, Zod schema, or shared utilities — per README rule 4, wait until 3 experiments want the same thing.
