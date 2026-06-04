# Question

Can multiple bounded browser investigators, given only a behavioral symptom and a live UI, discover a reproducible interaction/timing path and have a clean verifier confirm it independently?

## Why this question

The new value is not another browser session, viewer, or side-by-side replay. Those substrates already exist locally and through Cloudflare Browser Run.

The product claim under test is narrower and harder:

```text
vague browser behavior report
  → parallel independent investigation
  → candidate reproduction path
  → fresh-session confirmation
  → reusable proof for candidate-fix verification
```

If this fails on a controlled but non-trivial behavior, do not build an investigator product around anecdotes.

## Existing proved substrate this experiment may use

This experiment does **not** reopen auth or browser-provider research.

Already proved or present in this repository/adjacent products:

- Unsurf browser proof vocabulary: `proof-spec.v0` and `runSpec` / `verifySpec` / `runLoopSpec`.
- Local authful browser execution: Chrome For Testing / `agent-browser`, plus Unsurf extension/daemon work for browser-held authority.
- Hosted public browser execution: `exp-013` proved Browser Run BrowserHandle and native session recording via `@cloudflare/puppeteer@^1.1.0`.
- Consumer possibility: `my-ax` already renders Browser Run recordings inline and owns internal connector/auth UI.
- Session-bound dashboard execution possibility: Agent Lee browser capability ferry is separately proven for `dashboard.api_fetch_with_session` and related browser-owned actions.

For this experiment, use a public deterministic fixture and hosted or local browser sessions. Do not add auth complexity until the mechanism passes.

## Target fixture

Build a tiny public/local browser fixture representing the *shape* of the real delayed Agent Lee/sidebar issue, without depending on internal systems or probabilistic model behavior.

The fixture should appear to complete a user-triggered operation, then expose an unexpected delayed resumed state only under a discoverable interaction/timing condition.

Required characteristics:

- The visible UI has a plausible user action (for example, submit an assistant request or start a job).
- The apparent completion state is observable to a browser investigator.
- The later resumed/changed state is observable only after waiting and/or exercising a plausible lifecycle variation.
- The exact triggering path is **not** stated verbatim in the investigator prompt.
- A fixed variant exists where the unexpected resume never occurs and stable completion is observable.

Recommended seeded behavior shape:

```text
A response appears complete. If the user refreshes shortly after apparent
completion while a delayed continuation is pending, visible progress/text
resumes later on the broken build. The fixed build remains complete.
```

This is intentionally more meaningful than a trivial button/text assertion or an explicit double-click recipe.

## Investigator input

Give all investigators the same symptom and start URL only:

```text
Users report that after initiating a response/work item, the interface can
look complete and then unexpectedly resume or change later. Find a repeatable
path that demonstrates this behavior. Do not call it reproduced unless you
observe both apparent completion and a later contradictory resumed/changed
state. Return the shortest path you believe triggers it plus evidence.
```

Do **not** disclose the seeded refresh/timing trigger in the initial prompt.

## Investigators

Run four bounded investigators independently. They receive distinct causal lenses, not the answer.

### Investigator 1 — timing observer

Focus on completion versus delayed activity. Trigger a normal operation and continue observing after apparent completion. Try reasonable wait windows.

### Investigator 2 — lifecycle/recovery observer

Explore common interruption/recovery actions such as refresh, revisiting, or navigation state while work is in progress or just after it appears complete.

### Investigator 3 — repeated-interaction observer

Explore whether starting another action, repeated submit, or rapid successive interaction exposes stale/resumed state.

### Investigator 4 — skeptical free explorer

Try to falsify the report using any bounded plausible user path. Prefer simple paths a reviewer could replay.

## Required candidate output

Each investigator must return structured candidate output, even when it finds nothing:

```json
{
  "investigator": "lifecycle-recovery",
  "hypothesis": "...",
  "status": "candidate" | "not-found" | "blocked" | "error",
  "preconditions": ["..."],
  "steps": [
    { "op": "...", "detail": "..." }
  ],
  "apparentCompletionObserved": true,
  "laterUnexpectedChangeObserved": true,
  "observations": ["..."],
  "evidence": [
    { "kind": "screenshot" | "recording" | "snapshot" | "timeline", "ref": "..." }
  ],
  "confidence": 0.0
}
```

Free-form prose alone does not count.

## Confirmation verifier

Candidate discovery is not a pass.

The orchestrator must choose the strongest candidate path and replay it in clean browser sessions that did not participate in discovery.

Minimum verification:

- Replay candidate path on broken fixture in 3 fresh sessions.
- Replay the same path on fixed fixture in 3 fresh sessions.
- Capture assertion outcomes and evidence references for each run.

A behavior counts as confirmed only if:

```text
broken: reproduced in at least 2 / 3 fresh verification runs
fixed:  reproduced in 0 / 3 fresh verification runs
fixed:  stable expected completion observed in at least 2 / 3 runs
```

## Artifact shape

This experiment may use an experiment-local receipt shape rather than modifying frozen `proof-spec.v0`.

Required output:

```text
exp-014-can-parallel-browser-investigators-discover-and-confirm-a-repro/
  BRIEF.md              # frozen before first execution
  fixture/              # broken/fixed browser target or deployment source
  run.*                 # bounded harness
  out/
    investigation.json
    confirmed-proof.json
    comparison.json
    report.md
    evidence/
  RESULT.md
```

`confirmed-proof.json` should be as close as practical to `proof-spec`, but do not change `@acoyfellow/proof-spec` during this experiment merely to express temporary harness details.

## Browser/provider choice

Preferred first provider: **Cloudflare Browser Run** for the public fixture, because this tests the eventual hosted/public execution story and provides native session recording/Live View capabilities.

Acceptable diagnostic fallback: local Chrome For Testing / `agent-browser` if Browser Run blocks experiment progress for a provider-specific reason. If fallback is used, classify the result honestly as local-provider-only rather than proving hosted execution.

Do not use BaseLayer in this experiment. BaseLayer is a possible later density/provider comparison after the investigation mechanism earns scaling work.

## Pass

Mark **Pass** only if all are true:

1. The initial investigator prompt does not reveal the seeded triggering path.
2. At least one investigator produces a candidate path that substantially identifies the triggering interaction/timing condition.
3. A fresh verifier replays that path against the broken fixture and reproduces the unexpected behavior in at least 2/3 runs.
4. The same path does not reproduce the bug on the fixed fixture in 3/3 runs.
5. Positive stable-completion behavior is observed on the fixed fixture in at least 2/3 runs.
6. The resulting `report.md` is understandable to an MR reviewer without reading fixture source or existing test infrastructure.
7. Evidence includes an inspectable action/state timeline and screenshots or Browser Run session-recording references for confirmation runs.

## Fail

Mark **Fail** if any are true after the timebox:

- Investigators cannot discover the seeded trigger without being told the path.
- An apparent candidate cannot be reproduced by a fresh verifier.
- The verifier cannot distinguish broken from fixed behavior reliably.
- Reports rely primarily on investigator narrative instead of replay evidence.
- Browser execution/evidence is too unreliable to produce a reviewable artifact.

## Ambiguous

Mark **Ambiguous** only if the investigator mechanism appears to work but a substrate issue prevents a fair verdict, for example:

- Browser Run session-recording retrieval permission blocks evidence inspection while deterministic action/state results pass;
- fixture deployment infrastructure fails after candidate discovery;
- provider-specific timing prevents a fair 3+3 replay run but local replay establishes the mechanism.

Do not use Ambiguous for merely disappointing investigator quality.

## Kill-by

One bounded implementation/evaluation pass. Do not build product UI, MR integration, or authentication adapters in this experiment.

If the fixture plus harness is not yielding a first complete investigation/verification attempt quickly, simplify implementation mechanics without making the seeded trigger explicit to investigators. If a complete attempt still cannot produce a confident result, write `RESULT.md` as Fail or Ambiguous and stop.

## Graduation recommendation if Pass

If this passes, graduate only the smallest earned surfaces:

1. An Unsurf experiment-informed comparison/result shape for confirmed browser proofs.
2. A minimal `find`/`verify` concept, initially behind an experimental entry point.
3. One `my-ax` consumer spike that renders the confirmed report/recording result in the existing internal UI.

Do not immediately:

- rebrand all of Unsurf;
- build a desktop terminal/browser shell;
- delete Agent Lee, auth-research, echo, machinectl, or related proof repos;
- introduce BaseLayer as the default provider;
- claim arbitrary authenticated internal UI coverage until exercised through the appropriate already-proven authority adapter.

## Relationship to internal dogfood after Pass

After a public fixture passes, choose one real internal behavior and route it through the correct existing authority path:

| Internal behavior shape | Candidate execution path |
|---|---|
| Public/non-session-bound preview | Browser Run through Unsurf/my-ax |
| Stratus/dashboard session-bound action | Agent Lee browser capability ferry |
| Local authenticated real-browser UI | Unsurf local CDP/daemon/Chrome For Testing |
| Remote internal metadata/MR lookup | my-ax connector bridge |

The experiment earns the mechanism; existing auth work supplies the later execution adapters.
