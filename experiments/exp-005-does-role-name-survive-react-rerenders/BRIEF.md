# exp-005-does-role-name-survive-react-rerenders

## Status: Deferred pending exp-003 data

This experiment is DEFERRED. Its core question (does role+name survive React/Vue/Svelte re-renders?) is partially answerable from exp-003s coverage, which already tests React SPAs (react.dev, TodoMVC) and a Shadow-DOM site (YouTube). exp-003 step 10 now records `rerender_observations` across its 10-site matrix. exp-005 runs as a full dedicated deep-dive ONLY IF exp-003s sampled observations are inconclusive — i.e. exp-003 RESULT.md explicitly requests exp-005 execution. Until then, this BRIEF is retained as evidence of the question but not run.

## Question
Determine whether `{role, name, nth}` target identifiers (the CONTRACT.md `Target` shape) continue to resolve to the same element after React/Vue/Svelte state updates, re-renders, and client-side route changes — or whether they silently break and require DOM-mutation-aware invalidation.

## Why this question
The entire CONTRACT.md resilience story rests on the claim that role + accessible name is a stable addressing scheme — stable enough that a synthesized `tool-spec.v0.json` can be cached and replayed later without re-scouting. If role+name silently drifts across normal framework re-renders (stale element references, duplicated accessible names after a list update, route changes leaving detached nodes in memory), then every tool runner needs a MutationObserver-backed invalidation layer on day one, caching gets much more complex, and exp-003's runner contract changes. Conversely, if role+name is robust across re-renders, we can treat each DSL op as a fresh accessibility-tree query and skip invalidation entirely for v0. This is a kill-switch: a Fail here forces a different addressing scheme (test-ids? anchor paths?) before any other experiment ships.

## Method
1. Scaffold four tiny fixture apps in `experiments/exp-005-.../fixtures/`, each served on `localhost`:
   - `react/` — Vite + React 18 + react-router-dom v6. Three routes: `/counter` (button "Increment", heading "Count: N"), `/form` (controlled inputs: "Name", "Email", "Message"; button "Send"), `/list` (adds/removes listitems with identical accessible names to force `nth` collisions).
   - `vue/` — Vite + Vue 3 + vue-router. Same three routes, same accessible names.
   - `svelte/` — Vite + Svelte 5 + svelte-routing (or SvelteKit SPA mode). Same three routes.
   - `vanilla/` — single static HTML file with the same widgets wired via inline `<script>`. Control group.
2. Write one shared Playwright test harness in `experiments/exp-005-.../harness.ts`. Playwright's `getByRole(role, { name })` is the concrete implementation of CONTRACT.md's Target resolution; use it as the resolver under test.
3. For each fixture, for each target in a fixed pre-snapshot set (e.g. `{role: "button", name: "Increment"}`, `{role: "textbox", name: "Email"}`, `{role: "button", name: "Send"}`, `{role: "listitem", name: "Item", nth: 2}`), record the resolved element's `elementHandle` identity (via `evaluateHandle` → attach a `data-exp005-id` uuid).
4. Trigger each of the following events in isolation, then re-resolve every target and compare against the snapshot uuid:
   - **state-update**: click "Increment" 5×.
   - **controlled-rerender**: type into each form field.
   - **list-mutation**: add 3 listitems, remove 1.
   - **same-route-remount**: toggle a key-changing wrapper to force unmount/remount of the same subtree.
   - **route-change-and-back**: navigate `/counter` → `/form` → `/counter`.
   - **async-rerender**: resolve a `setTimeout(..., 100)` that triggers `setState`.
5. Record per (framework, event, target) one of: `RESOLVED_SAME` (new handle points to same uuid), `RESOLVED_NEW` (resolves cleanly but to a different element instance — expected and fine for v0 because we re-query each op), `AMBIGUOUS` (multiple matches, `nth` needed or wrong), `FAILED` (no match / throws), `STALE` (old handle still held by cached resolver returns detached node).
6. Emit `results.json` and a human-readable `results.md` table. Write a two-paragraph recommendation in `RESULT.md`: (a) must exp-003's runner re-query on every op (yes/no), (b) is MutationObserver-backed invalidation required for v0 (yes/no/maybe later).

## Inputs
- CONTRACT.md `Target` shape (role, name, nth) — consumed as the spec under test.
- Nothing from prior experiments. This runs independently.
- Pinned versions: React 18.3.x, Vue 3.5.x, Svelte 5.x, Playwright 1.49.x, Vite 6.x.

## Outputs
- `experiments/exp-005-.../fixtures/{react,vue,svelte,vanilla}/` — four minimal apps.
- `experiments/exp-005-.../harness.ts` — shared Playwright resolver test.
- `experiments/exp-005-.../results.json` — raw (framework, event, target, outcome) records.
- `experiments/exp-005-.../results.md` — table summarizing pass/fail per cell.
- `experiments/exp-005-.../RESULT.md` — Pass/Fail/Ambiguous verdict + day-one recommendation for SelectorResolver's invalidation strategy.
- Does **not** produce `tool-spec.v0.json`. Does not consume one.

## Kill-by
2 hours. If fixtures aren't all scaffolded by the 45-minute mark, drop Svelte and keep React + Vue + vanilla. If Playwright harness isn't green on vanilla by the 75-minute mark, write RESULT.md with whatever data exists and stop.

## Pass / Fail / Ambiguous criteria
- **Pass** = for all four frameworks, across all six event types, every target resolves with outcome `RESOLVED_SAME` or `RESOLVED_NEW` on re-query (cleanly, no `AMBIGUOUS`/`FAILED`), AND no target requires `nth` disambiguation that wasn't already needed in the pre-snapshot. Conclusion: runner can re-query every op, no invalidation layer needed for v0.
- **Fail** = any framework produces ≥1 `FAILED` or `AMBIGUOUS` result on a target that resolved cleanly in the pre-snapshot, under any event other than `list-mutation` (list-mutation failing is an expected `nth` concern, not a role+name failure). Conclusion: role+name is not sufficient as the v0 addressing scheme; escalate.
- **Ambiguous** = failures occur only under `async-rerender` or `same-route-remount` in one framework but not others, or only on `listitem` targets. Conclusion: runner must re-query every op and document framework-specific caveats; invalidation layer is optional.

## What could surprise us
- React's `<StrictMode>` double-render leaves a detached node reachable by Playwright's accessibility tree momentarily, producing `AMBIGUOUS` on the first post-mount resolution.
- After a route change and back, `getByRole` finds zero elements for ~1 frame because react-router's Suspense fallback replaces the tree before remounting — forcing the runner to add a minimum wait, even without an explicit `wait` verb in the DSL.
- Svelte's reactivity produces zero resolution failures across all events, because its compiled updates don't unmount subtrees the way React's reconciler does — suggesting framework-specific perf characteristics matter more than we assumed.

## Integration target
- Findings graduate into **`src/services/SelectorResolver.ts`** (to be created by exp-003). Specifically:
  - Whether `resolve(target: Target): Promise<Element>` must re-run the accessibility-tree query on every call, or whether it may cache handles.
  - Whether the resolver needs a MutationObserver subscription to invalidate a cache.
  - A short "known-fragile patterns" list added as a doc comment at the top of `SelectorResolver.ts`.
- A secondary note may land in **`src/domain/Fingerprint.ts`** if the results show DOM-structure fingerprints are invalidated by benign re-renders (which would affect exp-007).
- If this experiment is un-deferred and passes, the findings graduate into src/services/SelectorResolver.ts AND become a required reference in exp-003s post-mortem if exp-003 failed on rerender-related grounds.

## Contract interaction
- **Consumes**: the `Target` shape from CONTRACT.md (role, name, optional nth). Does not consume any `tool-spec.v0.json` file.
- **Produces**: neither. This experiment validates an assumption *behind* the contract. A Fail result causes a BACKLOG.md entry proposing an addition to `Target` (e.g. an optional `anchor` field for stable re-identification). Under the contract's write-once rule, this experiment cannot modify CONTRACT.md itself.
- **Cares specifically about**: `Target.role`, `Target.name`, `Target.nth`, and the implicit assumption in CONTRACT.md line "If the synthesizer cannot determine a role or a stable accessible name, it must not emit the tool." — this experiment tests whether "stable at synthesis time" implies "stable at replay time."

## Out of scope
- Shadow DOM piercing (CONTRACT.md non-goal; defer).
- iframes (CONTRACT.md non-goal; defer).
- Multi-step flows that navigate across real (non-SPA) page loads.
- Measuring resolution *latency* — this is correctness-only; exp-012 handles perf.
- Prescribing the implementation of MutationObserver invalidation. This experiment only decides whether one is required; exp-003 designs it if so.

