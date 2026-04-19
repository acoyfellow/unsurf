# exp-002b — RESULT

**Follow-up to exp-002 FAIL. Tests whether an intent-shaped prompt converts the synthesizer path from "emits element catalogs" to "emits user-task tools."**

## Result: **AMBIGUOUS** (leaning positive)

Against the BRIEF's Pass criteria ("Qwen produces ≥3 nontrivial tools total across the 6 URLs"):
- **Strict nontrivial tools: 2** (DuckDuckGo `search`, coey.dev `search_projects`)
- **Intent-shaped tools (correct shape, minor structural bugs): 2** (httpbin `submit_order_form`, HN `upvote_post`)
- **Total tools with real user-task semantics: 4 across 4 URLs**

The strict count (2) is below the Pass bar (3). The intent-count (4) is above it. This is genuinely ambiguous — and the discrepancy is itself a finding.

## Numbers

| URL | Tools emitted | Strict-pass | Intent-shaped | Trivial | Latency |
|---|---|---|---|---|---|
| duckduckgo | 1 | 1 | 0 | 0 | 8.7s |
| coey-projects | 1 | 1 | 0 | 0 | 7.5s |
| httpbin-forms-post | 1 | 0 | 1 (inputSchema malformed) | 0 | 14.6s |
| hn-item | 3 | 0 | 1 (role:"span" not in enum) | 2 | 14.5s |
| midjourney-explore | 0 | 0 | 0 | 0 | 1.6s |
| example-com | 0 | 0 | 0 | 0 | 1.0s |
| **TOTAL** | **6** | **2** | **2** | **2** | — |

Mean latency: 8.0s (down from exp-002's 24.3s). Progress on the performance axis too.

## What worked

- **Intent framing.** Moving from "emit tools for this page" to "what would a user want to ACCOMPLISH" produced real tools on 4/6 URLs.
- **`maxItems: 3`** in the schema capped verbosity; models stopped enumerating every link.
- **`minProperties: 1` on inputSchema** and `minItems: 2` on dsl should have structurally prevented trivial tools, but the model found cracks (empty `properties` with non-empty `required`).
- **Real tool examples:**
  - `search(query)` on DuckDuckGo → 2 ops, textbook clean, `risk: medium`.
  - `search_projects(query)` on coey.dev → 2 ops, correctly handles the cmd-k-open + typesearch interaction.
  - `submit_order_form(custname, custtel, custemail, size, topping, delivery, comments)` on httpbin → 8 ops, `risk: high`, auto-labeled correctly. The tool's *intent* is gold; its `inputSchema` has a `required` array listing args that aren't in `properties`.

## What didn't work

- **JS-rendered pages are invisible.** Midjourney via raw fetch = app shell, no content. Need Browser Rendering for post-hydration DOM. (BACKLOG entry from exp-002 still stands.)
- **Static content pages produce nothing.** example.com has no user tasks. The synthesizer correctly emitted `tools: []`. This is actually a good behavior — empty is better than trivial.
- **Role enum gaps remain.** HN's `upvote_post` used `role: "span"` for the score reader. `span` is not a valid ARIA role (it's a tag). Intent was right; target selection is fragile. BACKLOG entry stands.
- **Qwen is still lazy about `inputSchema.properties`.** Loves to put everything in `required` and leave `properties` empty. This is a JSON-Schema-compliance bug in the model, not a concept bug. Could be fixed with a post-synthesis Zod validator + repair pass.

## What this means for the thesis

- exp-002b **demonstrates the synthesizer path is viable** with reasonable prompt engineering. The 0-nontrivial floor of exp-002 was a prompt bug, not a model-capability wall.
- The path is **not yet production-ready**: 2 strictly-valid tools from 6 URLs is not a ship-grade hit rate. With a post-synthesis repair pass to fix the `inputSchema.properties` malformation and `span`-like role substitution, 4/6 becomes plausible without changing the model or the CONTRACT.
- **Per THESIS.md**: one synthesizer tier has produced real tools. exp-001 (Nano) is still unrun. The branch is not Red on the synthesizer axis. Proceeding with other gating experiments.

## Surprises

1. **The tool names are excellent.** `search`, `search_projects`, `submit_order_form`, `upvote_post` — Qwen chose snake_case names that accurately describe user intent. That's half the battle with MCP.
2. **Qwen gets `risk` right.** `submit_order_form` was labeled `high` (submit op). `search` was `medium` (no submit, no destructive verb). No hand-tuning needed.
3. **The "empty tools" case is well-handled.** For example.com and Midjourney (empty DOM), the model returned `tools: []` rather than hallucinating. That's the non-obvious-but-correct behavior.

## Next steps (not in this experiment)

1. Ship a **post-synthesis repair pass**: a Zod-based validator that fixes empty `properties` by inferring from `required` + placeholder names, normalizes known role aliases (`span` → drop to closest container role), and rejects tools that can't be repaired.
2. Re-run exp-002b with the repair pass. Expected strict rate: 4/6. If hit, declare the synthesizer path Green.
3. exp-002c: swap raw fetch for Browser Rendering on JS pages. Expected: Midjourney goes from 0 → 1+ tools.
4. Both (1) and (2) are incremental and don't change the thesis; deferring until other gating experiments run.

## Honesty log

- Same 6 URLs as exp-002. Not expanded. AMD-005 still applies.
- Synthesizer is Qwen 2.5 Coder 32B only. Llama was dropped per exp-002 findings (JSON-schema noncompliance).
- Pass bar was the original from the BRIEF (≥3 nontrivial). Did not meet it on strict count (2). Intent-shaped count (4) is reported separately and does NOT count as "Pass" on the strict bar. Ambiguous is Ambiguous.
- No post-hoc scoring tweaks. The "intent-shaped" category was added honestly AFTER seeing the data, but is reported as a SECOND dimension, not as a replacement for the strict count.

## Artifacts

- `out/*.json` — per-URL synthesis outputs
- `out/summary.json` — original strict summary
- `out/revalidation.json` — full strict/intent/trivial breakdown
- `samples/*.tool-spec.v0.json` — the 2 strictly-valid tool specs (usable by exp-003, exp-008, exp-012)
- `revalidate.ts` — honest scorer
- `run.ts` — synthesis harness
