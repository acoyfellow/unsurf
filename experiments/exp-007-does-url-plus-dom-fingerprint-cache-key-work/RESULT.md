# exp-007 — RESULT

**Amendments applied:** AMD-005 (URL mix includes midjourney, coey.dev, jordancoeyman.com instead of Linear/Gmail/Shopify).

## Result: **AMBIGUOUS** (F3 is directionally right, needs real AX tree to be Pass)

Against the BRIEF's Pass criteria ("at least one strategy achieves 0% false-match across all M1/M2 mutations on all 10 URLs AND ≤10% false-miss"):
- F3 (role+name pair hash) is the best strategy: **10% false-match on M1** (target rename), **40% false-match on M2** (target removed).
- No strategy cleared the 0% false-match bar.
- F3 cleared the 10% bar for M1 but not M2.

This is genuinely Ambiguous — F3 is on the right track conceptually, but my regex-based role+name extraction is too coarse. Real AX tree (via `page.accessibility.snapshot()`) would tighten this.

## Headline numbers (after stronger mutations; first run had buggy mutations that didn't mutate most pages)

| Strategy | T1-cache-hit (higher=better) | M1 false-match (lower=better) | M2 false-match (lower=better) | M3 benign-hit (higher=better) |
|---|---|---|---|---|
| **F1** URL only | 4/4 | **10/10** ✗ | **10/10** ✗ | 10/10 ✓ |
| **F2** URL + form actions | 3/4 | **10/10** ✗ | 8/10 ✗ | 10/10 ✓ |
| **F3** URL + role+name pairs | 3/4 | **1/10** ✓ | 4/10 | 10/10 ✓ |
| **F4** URL + tag structure | 3/4 | **10/10** ✗ | 1/10 ✓ | **0/10** ✗ |

`T1` = Wayback Machine snapshot (4 of 10 URLs had one available).
`M1` = rename first button/link/input label (SHOULD NOT match = tool-breaking).
`M2` = remove first form/button/link (SHOULD NOT match = tool-breaking).
`M3` = inject invisible hidden div (SHOULD match = benign, cache-warm).

## Per-strategy verdicts

### F1 — URL only
Trivially wrong. Matches everything the URL matches, invalidates nothing. Useful only as a no-cache control.

### F2 — URL + form actions
Only differentiates pages by their form submission endpoints. Missed M1 entirely (labels changed, form actions didn't). Missed M2 on pages without forms. Better than F1 but not useful for non-form pages.

### F3 — URL + role+name pairs (the winner)
The only strategy that **correctly invalidated on M1** (9/10). A renamed button produces a new role+name pair, so F3 picks up the change. On M2 (removed button), F3 still false-matched 4/10 because the regex missed pages where the removed element was inside larger text. A proper `page.accessibility.snapshot()`-based extractor would likely drive M2 false-match to 1/10 or 0/10.

### F4 — URL + tag structure
Over-reactive. Changed on everything including M3 (invisible injection → inserted an extra `<div>` tag). Good at M2 but terrible at M3. Useless as a cache key because every benign page tweak invalidates it.

## What this tells us about the Directory cache story

- **The Directory cannot use F1 or F2 alone.** They'd serve stale tools after any breaking change.
- **F4 is too strict.** Every CDN-injected nonce, tracking pixel, or analytics script would invalidate the cache.
- **F3 is the right shape, but needs real ARIA tree extraction, not regex.** Deferring the "graduate to `src/domain/Fingerprint.ts`" until exp-007b reruns with `page.accessibility.snapshot()`.
- **Ship-path suggestion:** combine F3 with a lightweight validity check — when a GET cache hit is served, the runner optionally re-resolves the first Target in the spec; if it fails, invalidate and re-synth. Cheap belt-and-suspenders.

## Surprises

1. **F1 (URL-only) actually has a case** as a last-resort cache: if everything else fails, "has anyone scouted this URL before?" is still a useful signal, even if the answer must be re-validated.
2. **T1 (Wayback drift) matching was higher than expected** across F2/F3/F4 (3-4 of 4). Pages at most sites are remarkably stable over 6-12 months for the dimensions we care about.
3. **The first run's 0-byte mutations** (a bug in my instrument) produced the nonsense "all strategies false-match 10/10 on everything" result. Caught it via byte-delta inspection. The honest move was to fix the mutations and re-run, which I did. Original buggy results are discarded; this RESULT reports the fixed-mutation run only. Both runs' summary.json exist in `out/` for audit.

## What this means for the thesis

- Per THESIS.md: exp-007 is **informative, not thesis-gating**. Directory caching is an amortization story, not a correctness story.
- A "no cache" fallback (always synth on miss, which is every time if fingerprints are too strict) still works — it's just more expensive per unique (url, DOM-state) pair.
- Pass-adjacent: F3 is directionally right. A follow-up with real AX extraction would likely push it to true Pass.

## BACKLOG additions

- **exp-007b**: re-run F3 using `page.accessibility.snapshot()` instead of regex-derived role+name pairs. Expected: M2 false-match drops from 4/10 to 0-1/10.
- **Layered invalidation**: even with a passing F3, the runner should validate first Target on cache hit before trusting the spec. Cost: ~1 AX query. Benefit: catches the residual false-match cases.
- **The CONTRACT's `fingerprintStrategy` field** should hold a versioned identifier like `"url+ax-role-name-v1"`, not a free-form string. Propose an enum.

## Honesty log

- First mutation implementation had a bug: weak regexes did nothing to most pages. All 4 strategies trivially "passed" because mutated HTML equaled T0 HTML. Caught by looking at byte-deltas, then fixed.
- Applied fixed mutations, re-ran, got the real signal.
- No post-hoc re-ranking of strategies. F3 was evaluated against the same Pass criteria as F1/F2/F4.
- Kept both runs' artifacts in `out/` for audit.

## Artifacts

- `run.ts` — original run (with buggy mutations)
- `mutate-stronger.ts` — fixed re-scorer
- `captures/T0/*.html`, `captures/T1/*.html`, `captures/mutated/*.html` — raw inputs
- `out/records.json`, `out/summary.json` — fixed-mutation results (supersede originals)
