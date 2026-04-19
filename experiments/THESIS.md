# THESIS.md — branch-level exit criteria

## The thesis under test

Unsurfs scout/worker/heal loop can be extended to capture WebMCP tools from any webpage — synthesizing tool specs on the fly, executing them via a safe DSL, caching them in the Directory — delivering a measurable speed and cost advantage over remote-LLM-driving-headless-Chrome (agent-browser) on realistic agent tasks. This thesis is falsified if any of the following gates fail.

## Gating experiments (thesis-critical)

These four MUST pass for the branch to graduate. Failure of any one kills the thesis as currently framed.

- **exp-003** (DSL can execute on real sites) — `experiments/exp-003-can-six-verb-dsl-execute-on-ten-real-sites/BRIEF.md`. Failure means the six-verb DSL is not expressive enough to drive real pages, so synthesized tools cannot run; the entire execution layer is moot.
- **exp-004** (bridge actually reaches Claude Desktop) — `experiments/exp-004-can-mcp-b-bridge-synthesized-tools-to-claude/BRIEF.md`. Failure means synthesized tools cannot be surfaced to a real MCP client, so the user-facing value loop is broken.
- **exp-010** (extension inherits user auth) — `experiments/exp-010-can-extension-read-users-real-auth/BRIEF.md`. Failure means we cannot operate inside a logged-in session, collapsing the differentiator vs server-side scraping.
- **exp-012** (benchmark: synthesized path beats agent-browser on a realistic task) — `experiments/exp-012-benchmark-webmcp-path-vs-agent-browser-path/BRIEF.md`. Failure means even if everything works, there is no measurable advantage over the existing agent-browser path, so there is no reason to ship.

## Informative experiments (non-gating)

These inform the shape of the eventual implementation but are not thesis-critical.

- **exp-001** (Gemini Nano) — `experiments/exp-001-can-gemini-nano-emit-valid-tool-specs/`. Its failure only rules out one synthesizer tier.
- **exp-002** (Workers AI) — `experiments/exp-002-can-workers-ai-emit-valid-tool-specs/`. Its failure only rules out the other.
- **exp-005** (role+name survives re-renders) — `experiments/exp-005-does-role-name-survive-react-rerenders/`. Informs invalidation strategy.
- **exp-006** (DOM extraction modes) — `experiments/exp-006-how-much-does-smart-dom-reader-beat-raw-html/`. Informs prompt input shape.
- **exp-007** (fingerprinting) — `experiments/exp-007-does-url-plus-dom-fingerprint-cache-key-work/`. Informs Directory cache keying.
- **exp-008** (prompt injection) — `experiments/exp-008-can-prompt-injection-poison-synthesized-tools/`. Informs whether Pass experiments are safe to publish externally.
- **exp-009** (Prompt API postcondition gate) — `experiments/exp-009-does-prompt-api-gate-postconditions-cheaply/`. Informs optional fast-path.
- **exp-011** (Directory schema) — `experiments/exp-011-unsurf-directory-as-webmcp-tool-catalog-registry/`. Informs next PR, not thesis.

**Caveat:** BOTH exp-001 AND exp-002 failing together IS gating. No synthesizer = no thesis. If neither tier can emit valid tool specs, the synthesis layer collapses regardless of how well the other gates pass.

## Traffic-light decision matrix

- **Green (ship v0):** all four gating experiments pass AND at least one of exp-001 OR exp-002 passes.
- **Yellow (ship v0 with documented gaps):** exp-003, exp-004, exp-010 pass; exp-012 is Ambiguous; at least one synthesizer (exp-001 or exp-002) passes.
- **Red (kill or pivot):** any of exp-003, exp-004, exp-010 fails; OR exp-012 fails; OR both exp-001 AND exp-002 fail.

## Publication gate

Results may be written up externally only if exp-008 is Pass OR the RESULT.md explicitly marks `safe-to-publish: yes`. No external post, memo, blog, or tweet until that line exists.

## Graduation gate

Green = open PR(s) into unsurf main implementing: exp-003 runner into `src/tools/DomWorker.ts`; exp-004 bridge as `examples/webmcp-extension/`; exp-010 extension plumbing into the same; exp-011 Directory schema addition; chosen synthesizer into `src/ai/`. NO `src/` edits happen before Green or Yellow.

## Freeze rule

This THESIS.md is frozen at the commit before the first experiment runs. If reality forces a change (e.g. we discover a fifth experiment is gating), that is a failed prediction and becomes a `BACKLOG.md` entry. Do not silently retune the gates post-hoc.
