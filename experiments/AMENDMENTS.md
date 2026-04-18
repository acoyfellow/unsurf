# AMENDMENTS.md — pre-execution amendments

Per the Freeze rule in `README.md`, BRIEFs cannot be edited in place after the first run. These amendments were agreed before the first execution and apply to the listed experiments. Each amendment is stamped with the commit before first execution.

---

## AMD-001 (exp-010) — narrow target list, drop enterprise SSO

**Amends:** `exp-010-can-extension-read-users-real-auth/BRIEF.md`
**Date:** 2026-04-18, pre-execution
**Reason:** User direction — autonomous execution only has access to three real logged-in sites: `midjourney.com`, `coey.dev`, `jordancoeyman.com`. The three-auth-model expansion (cookie + OAuth SSO + enterprise SSO) is not executable without credentials we do not have. Rather than fake it, we narrow the question.

**Effect:**
- Replace M1/M2/M3 (GitHub cookie + Gmail OAuth + enterprise SSO) with:
  - **M1**: `midjourney.com` — consumer SaaS with cookie session
  - **M2**: `coey.dev` / `jordancoeyman.com` — user's own personal sites (cookie-session if logged into any backend, static if not)
- Drop the enterprise-SSO probe entirely.
- Keep the negative control (`chrome://settings`).
- Pass criterion becomes: extension inherits session on `midjourney.com` AND negative control correctly denies.

**Honesty note in RESULT.md (required):**
"This experiment tested auth inheritance on a single consumer-SaaS target (Midjourney) plus personal sites. Enterprise SSO (Okta/Entra), OAuth SSO (Google Workspace), and cross-origin API-subdomain fetches are UNTESTED. Pass here proves the common-case; it does not prove Cloudflare enterprise customer readiness. That remains a future experiment."

**THESIS.md impact:** exp-010 remains thesis-gating for the narrowed question. The branch-level verdict note will state explicitly: "Auth inheritance is proven on consumer SaaS only; enterprise path requires follow-up."

---

## AMD-002 (exp-004, exp-012) — substitute headless MCP client for Claude Desktop

**Amends:** `exp-004-can-mcp-b-bridge-synthesized-tools-to-claude/BRIEF.md` and `exp-012-benchmark-webmcp-path-vs-agent-browser-path/BRIEF.md`
**Date:** 2026-04-18, pre-execution
**Reason:** Autonomous execution has no way to drive Claude Desktop's GUI. Substitute a headless MCP client (`mcphost`, `@modelcontextprotocol/sdk` with stdio transport, or a minimal hand-rolled client) so the experiment can complete without a human in the loop.

**Effect:**
- exp-004: replace "Claude Desktop" with "headless MCP client invoking `tools/call`". Success criterion unchanged: tool round-trips end-to-end.
- exp-012 Path B and Path C: same substitution. The LLM drive loop (Claude Sonnet) still runs via the Anthropic Messages API if a key is available, **otherwise Path B and Path C are invoked with programmatic tool calls** (no LLM planner) and the "tokens" column is reported as "LLM planner tokens: N/A (autonomous substitution)".

**Honesty note in RESULT.md (required):**
"This experiment validates the MCP plumbing. It does NOT validate that Claude Desktop (the real user-facing MCP client) discovers and invokes the tool correctly. A follow-up manual test with Claude Desktop is required before Green. The substitution is disclosed in RESULT.md."

**THESIS.md impact:** exp-004 Pass under substitution = thesis-Yellow at best for exp-004, not Green. A true Green for the bridge requires the manual Claude Desktop verification noted.

---

## AMD-003 (exp-001) — Gemini Nano availability check

**Amends:** `exp-001-can-gemini-nano-emit-valid-tool-specs/BRIEF.md`
**Date:** 2026-04-18, pre-execution
**Reason:** The experiment is non-gating and requires Chrome Canary with a specific flag and Gemini Nano downloaded. If Nano is not available on this machine, mark as `BLOCKED` with the exact reason and move on. Don't invent results.

**Effect:** First step of Method becomes: probe `navigator.LanguageModel.availability()` via agent-browser. If result ≠ `"available"`, write `RESULT.md` as **Blocked: Gemini Nano not available** with a one-line note on which prerequisite failed, and stop. No mock data.

**THESIS.md impact:** None (exp-001 is non-gating).

---

## AMD-004 (exp-002) — baseline comparisons depend on API keys

**Amends:** `exp-002-can-workers-ai-emit-valid-tool-specs/BRIEF.md`
**Date:** 2026-04-18, pre-execution
**Reason:** No `ANTHROPIC_API_KEY` in env. Claude Sonnet comparison cannot run.

**Effect:** Skip the Claude Sonnet comparison step. RESULT.md must state: "Claude Sonnet ceiling comparison SKIPPED — no API key available. Workers AI (Llama + Qwen) results stand on their own." Pass criterion adjusted accordingly: Pass is against the contract schema (does the spec validate?), not against a quality ceiling.

**THESIS.md impact:** exp-002 Pass is sufficient to prove "a synthesizer exists"; the "strictly better than Nano" requirement in the original BRIEF is relaxed because Nano may be Blocked (AMD-003). If both are Blocked/Failed, branch goes Red per THESIS.

---

## AMD-005 (all URL-using experiments) — logged-in target substitutions

**Amends:** `exp-002`, `exp-003`, `exp-006`, `exp-007`
**Date:** 2026-04-18, pre-execution
**Reason:** The "replace 3 URLs with logged-in SaaS" strengthening assumed access to Linear, Gmail, Shopify admin. We have access to `midjourney.com`, `coey.dev`, `jordancoeyman.com` only.

**Effect:** Wherever a BRIEF says "logged-in Linear / Gmail / Shopify admin", substitute:
- **slot A (app-like logged-in SaaS)**: `https://www.midjourney.com/explore` (logged-in feed)
- **slot B (personal-site app-ish view)**: `https://coey.dev/projects`
- **slot C (personal-site content)**: `https://jordancoeyman.com/`

If these don't require login (e.g. coey.dev is publicly viewable), note that in RESULT.md: the "logged-in" requirement is downgraded to "user-owned site" and some of the auth-inheritance value of the test case is lost. This is an honest limitation.

**THESIS.md impact:** The "realistic SaaS coverage" armor is weaker than designed. SUMMARY.md must explicitly acknowledge that the URL mix is skewed toward one consumer SaaS (Midjourney) and two personal domains.

---

## How these amendments interact with the Freeze rule

BRIEFs remain unchanged on disk. Execution reads BOTH the BRIEF AND this amendments file. RESULT.md in each experiment folder must begin with a line:

> `Amendments applied: AMD-001, AMD-003, ...` (or `none`)

This keeps the original framing auditable and makes every deviation explicit rather than silent.

---

## AMD-006 (exp-012) — benchmark deviations from BRIEF

**Amends:** `exp-012-benchmark-webmcp-path-vs-agent-browser-path/BRIEF.md`
**Date:** 2026-04-18, pre-execution
**Reason:** The BRIEF specified:
- 2 fixtures (httpbin + a realistic logged-in fixture)
- n=20 runs per path per fixture (120 runs total)
- Path A = Claude Sonnet via Anthropic API driving CDP
- Path B & C = Claude Desktop as the MCP client

Reality-driven deviations:
1. **No Anthropic API key available.** Path A substitutes Claude Sonnet with Qwen 2.5 Coder 32B via Workers AI driving CDP. Same pattern (remote LLM ↔ CDP snapshots ↔ action selection), different model. This means the "cost" column on Path A is Workers AI tokens, not Anthropic tokens. Absolute cost comparisons are not apples-to-apples; relative cost per path with the same model is.
2. **n=5 per path per fixture**, not n=20. Wall-clock budget: 20 runs × 3 paths × ~30s/run ≈ 30 minutes per fixture; 5 runs × 3 paths × ~30s = 7.5 minutes. Statistical power is much weaker. The RESULT will note this explicitly and mark verdict as "preliminary" when n is small.
3. **httpbin only** as the realistic task in this run. The "logged-in SaaS" fixture is deferred — a fresh headless Chrome has no Midjourney session (confirmed by exp-010), so "mark a notification read" isn't doable autonomously.
4. **Path B and Path C use the same headless-MCP-client from exp-004 (AMD-002)**, not Claude Desktop. Already disclosed in AMD-002.

**Effect:** The BRIEF's Pass criteria cannot be evaluated as written (n too small, Anthropic model absent). The RESULT provides:
- A 3-row comparison table with the observed numbers
- A marker `n=5; preliminary` in every cell
- A qualitative verdict based on effect size (did Path C roughly 2× outperform Path A on the cheap metric?), not p-values

**THESIS.md impact:** exp-012 under AMD-006 cannot deliver a clean Pass by the original Green criteria. At best it delivers a **qualitative "Path C is cheaper and faster" signal** which lands the branch in Yellow (ship v0 with documented gaps + plan for a proper n=20 benchmark on a real Anthropic key). If Path C is slower or more expensive, Yellow becomes Red.
