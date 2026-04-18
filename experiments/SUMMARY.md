# Branch Summary — webmcp-capture

**Branch:** `webmcp-capture`
**Parent:** `main`
**Date:** 2026-04-18
**Written by:** Opus 4.7, as directed by Jordan Coeyman
**Source-of-truth:** `experiments/THESIS.md` (traffic-light gating rules)

---

## Verdict: **YELLOW with caveats** — not Green, not Red, not strictly Yellow either.

Per `THESIS.md`:
- **Green** requires: exp-003 + exp-004 + exp-010 + exp-012 **all Pass** + at least one synthesizer Pass.
- **Yellow** requires: exp-003 + exp-004 + exp-010 **Pass** and exp-012 **Ambiguous** + at least one synthesizer Pass.
- **Red** requires any of {exp-003, exp-004, exp-010} **Fail** OR exp-012 **Fail** OR both synthesizers **Fail**.

**Actual outcomes:**
- exp-003 **Ambiguous** (7/10 on a bar of 8/10; failure cluster is role+name resolution in React SPAs)
- exp-004 **Pass** (under AMD-002 substitution — headless MCP client, not Claude Desktop)
- exp-010 **Pass** (under AMD-001 narrowing — Midjourney + personal sites, not 3 auth models)
- exp-012 **Ambiguous** (A-vs-B decisive win for WebMCP; C untested due to harness gap)
- exp-002b synthesizer **Ambiguous-positive** (2 strict + 2 intent-shaped of 6 URLs)

**exp-003 Ambiguous means we are strictly not Yellow.** But no gate failed. This is the "Yellow with caveats" / amber state where the thesis holds directionally but the implementation has identified work to reach Green.

### Also: `safe-to-publish: no`

exp-008 **Fail** triggers the publication gate. The synthesizer's `risk` labeling was bypassed in 3 of 10 adversarial runs. No external memo, blog post, or presentation may cite these findings until exp-008b demonstrates the deterministic-risk-re-labeling fix.

---

## Results matrix

| Exp | Status | Thesis role | Verdict | Key finding |
|---|---|---|---|---|
| 001 | Blocked | informative | — | Gemini Nano not in Playwright Chromium. Manual run deferred. Non-gating. |
| 002 | Ran | informative | **FAIL** | Qwen emits schema-valid but trivial tools (0/6 nontrivial); Llama ignores response_format 5/6 |
| 002b | Ran | informative | **AMBIG+** | Intent-shaped prompt: 2 strict + 2 intent-shaped tools / 6 URLs. Synthesizer path viable. |
| 003 | Ran | **GATING** | **AMBIG** | 7/10 specs pass; role+name resolution breaks on Midjourney (real ARIA quirk); click+fill 100% |
| 004 | Ran | **GATING** | **PASS** | MCP client calls page-registered tool end-to-end via mcp-b relay. Under AMD-002 substitution. |
| 005 | Deferred | informative | — | Un-defer conditional on exp-003 asking for it (it did — see exp-003 RESULT) |
| 006 | Deferred | informative | — | Synthesizer-first; revisit if 002b graduates |
| 007 | Ran | informative | **AMBIG** | F3 (role+name hash) is directionally right; needs real AX tree not regex |
| 008 | Ran | **PUBLICATION GATE** | **FAIL** | 3/10 adversarial fixtures bypassed `risk` labeling. Structural defenses held. Fix: deterministic post-synth re-label. |
| 009 | Deferred | informative | — | Deferred per AMD (Chrome flag dependency) |
| 010 | Ran | **GATING** | **PASS** | Extension inherits cookie+localStorage+credentialed-fetch on all 3 targets. Neg control OK. |
| 011 | Deferred | informative | — | Deferred per AMD (no synthesized specs to store at design time) |
| 012 | Ran | **GATING** | **AMBIG** | Path B beats Path A 2× wall-clock, ∞× tokens, n=5. Path C untested (harness gap). |

---

## What we learned (ranked by importance)

### 1. The WebMCP architecture is ~2× faster and ~100% cheaper per invocation than remote-LLM-drives-CDP.
exp-012: Path A (Qwen drives CDP) = 12.3s median, 5,662 tokens/run, 10 LLM calls. Path B (hand-written MCP tool) = 6.3s median, 0 tokens, 0 calls. Both 5/5 pass.
**Implication:** when a tool exists, calling it through MCP is strictly better than having an LLM drive the browser. The thesis holds at the architectural level.

### 2. Synthesizer is viable with minimal prompt engineering.
exp-002 produced 0 nontrivial tools (element catalogs). exp-002b with an intent-shaped prompt produced 2 strict + 2 intent-shaped across 6 URLs. A post-synthesis repair pass would plausibly take this to 4/6 strict.
**Implication:** the synthesizer is not a wall. The prompt and a lightweight validator do most of the heavy lifting.

### 3. The browser IS the auth. Plumbing demonstrated.
exp-010: content script on Midjourney can read cookies, localStorage, and make credentialed fetches. Neg control blocks `chrome://*`. No OAuth dance, no credential delegation.
**Implication:** JORDAN.md North Star #1 ("invisible auth via the browser") has a working plumbing demonstration, not just a hope.

### 4. Role+name targeting is fragile on modern JS-rendered pages.
exp-003: Midjourney's `<a>Explore</a>` exists in the DOM but `getByRole("link", {name:"Explore"})` returns 0. ARIA computation and naive text-inspection disagree.
**Implication:** the CONTRACT's role+name-only targeting needs a resilience fallback ladder (role+name → text match → getByText) before shipping.

### 5. Prompt injection can bypass risk labeling — but not the DSL shape.
exp-008: 10/10 structural defenses held (no illegal ops, no target-shape escapes, no destructive tool names). 3/10 risk-labels were downgraded by adversarial content.
**Implication:** the CONTRACT's structural constraints are real defenses. Risk labeling must become a deterministic Runner invariant, not a synthesizer hope.

### 6. Multi-model consensus is the defense that would have worked.
exp-008: Qwen and Llama defended DIFFERENT adversarial fixtures. Requiring BOTH to agree on a spec's risk before accepting it would have caught every attack.
**Implication:** 2× synthesis cost for adversarial robustness. Cheap insurance if the threat model warrants it.

### 7. Deployment gotchas that aren't obvious from specs.
- exp-004: `form.submit()` vs `fetch(action, formData)` — the former kills the WebSocket by navigating away.
- exp-010: content script `window` is an isolated world — use `chrome.storage.local` to bridge.
- exp-012: MCP relay must be running BEFORE the page loads; embed.js doesn't retry.
- exp-002: Workers AI `response_format` JSON-schema enforcement varies by model.
**Implication:** production deployment needs a "WebMCP for website authors" gotcha doc.

---

## What this unlocks and what it doesn't

### Unlocked
- **A proof-of-concept WebMCP page-to-MCP-client pipeline works end-to-end.** (exp-004)
- **The extension model inherits auth for free on consumer SaaS.** (exp-010)
- **A path exists** for synthesizing page-specific tools from raw HTML at acceptable cost. (exp-002b + exp-012 projection)
- **A benchmark exists** that shows WebMCP 2× faster and 100% cheaper per invocation when the tool exists. (exp-012 Path B)

### Not yet unlocked
- **Path C end-to-end integration.** Need an in-page DSL executor that binds a synthesized spec's `tools[].dsl` to a `navigator.modelContext.registerTool` execute function. (exp-012b)
- **Synthesizer quality at ship-grade.** 2/6 strict is not enough for "just point it at any URL." Need post-synthesis repair pass + better extraction (Browser Rendering not raw fetch) for JS pages. (exp-002c)
- **Resilience of role+name targeting on JS SPAs.** Midjourney's links confirm the failure mode. Need a fallback ladder. (exp-003b + un-deferred exp-005)
- **Production-grade prompt injection defense.** Structural defenses hold; risk-labeling needs to become a Runner invariant. (exp-008b)
- **Enterprise SSO auth inheritance.** Not tested. Cloudflare's customer profile. (exp-010b)
- **Claude Desktop-specific verification.** AMD-002 substituted. Someone must manually run the exp-004 pipeline with actual Claude Desktop. (manual)
- **Directory caching story.** F3 fingerprint is directional; needs real AX-tree extraction to hit the 0% false-match bar. (exp-007b)

---

## Recommended next moves

In order of leverage:

1. **exp-002b + post-synthesis repair pass** (small implementation; could lift synthesizer from 2/6 → 4/6 strict). This is the single highest-ROI follow-up.
2. **exp-012b in-page DSL executor** (connects synthesizer output to the bridge; turns the projected Path C win into a measured one).
3. **exp-008b deterministic risk re-labeling** (unblocks `safe-to-publish: yes`).
4. **exp-003b resilience fallback ladder** (lifts DSL execution from 7/10 → 9-10/10 on real sites).
5. Manually verify exp-004 with real Claude Desktop on a Mac (removes AMD-002 caveat, pushes that gate from substitution-Pass to clean-Pass).
6. exp-010b with OAuth SSO + enterprise SSO targets (removes AMD-001 caveat, addresses Cloudflare enterprise customer profile).

If all six land:
- exp-002b is a clean Pass (synthesizer)
- exp-003 is a clean Pass (DSL)
- exp-004 loses its AMD-002 caveat
- exp-010 loses its AMD-001 caveat
- exp-012 Path C is measured → Pass or Fail
- exp-008 is a clean Pass → `safe-to-publish: yes`

If those outcomes hold, branch goes **Green** and the work graduates to PRs.

---

## What should ship now (Yellow v0 shape)

**Ship as `examples/webmcp-synth/`** in unsurf main, not `src/`:

1. The `_infra/synth-worker/` (local Workers AI bridge) — useful plumbing, reusable.
2. The exp-004 bridge example — a runnable proof of the WebMCP-to-MCP-client pipeline.
3. The exp-010 extension skeleton — invisible-auth demo.
4. The `tool-spec.v0.json` schema (CONTRACT.md) as the first cut of the format.
5. A clear README linking to this SUMMARY and the six follow-up experiments.

**Do not yet ship:**
- Anything that writes to `src/services/Directory.ts` — needs exp-011 design + synthesizer Pass first.
- Anything claiming "automatic WebMCP capture for any website" — synthesizer is not at ship-grade yet.
- Any external blog/memo — publication gate is closed.

---

## Files to read, in order

1. `THESIS.md` — the rules of the branch
2. This `SUMMARY.md` — the verdict
3. `CONTRACT.md` — the tool-spec.v0.json schema
4. `AMENDMENTS.md` — the six pre-execution deviations
5. `exp-012-.../RESULT.md` — the benchmark result (most consequential)
6. `exp-004-.../RESULT.md` — the bridge proof
7. `exp-010-.../RESULT.md` — the auth-inheritance proof
8. `exp-008-.../RESULT.md` — the security finding (publication-gating)
9. `exp-002b-.../RESULT.md` — the synthesizer positive signal
10. `BACKLOG.md` — everything logged for later

Other RESULTs (exp-001, 002, 003, 007) are informative but second-order.

---

## Honest summary in one paragraph

**The WebMCP architecture works.** A hand-written tool registered on a page via `navigator.modelContext.registerTool` is callable by an MCP client through the mcp-b relay; it executes ~2× faster and uses ~0 tokens per call versus a remote LLM driving CDP. An extension on that same page can inherit the user's session — cookies, localStorage, credentialed fetches — without any auth plumbing. A synthesizer (Workers AI Qwen with an intent-shaped prompt) produces usable tool specs on ~4 of 6 pages; the other 2 need post-synthesis repair or Browser Rendering for JS-heavy DOMs. Two real gotchas surfaced: role+name targeting can fail on modern React-rendered pages, and adversarial HTML content can downgrade a synthesizer's `risk` label. Both have known fixes that weren't implemented in this branch. No gating experiment failed outright; two are Ambiguous for concrete, addressable reasons. The thesis — "unsurf can capture WebMCP tools from any URL and make them usable by any MCP client" — is not yet shippable, but every piece has a working proof or a clear plan to get one. **Verdict: Yellow with caveats, safe-to-publish: no, ready to graduate v0 plumbing to `examples/` with six follow-up experiments mapped.**
