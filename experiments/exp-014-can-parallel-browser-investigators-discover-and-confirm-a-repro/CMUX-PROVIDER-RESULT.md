# cmux provider prerequisite — Result: Pass with shared-profile constraint

Date: 2026-06-16

## Question

Can Unsurf drive explicit cmux in-app browser surfaces through `cmux browser`, capture proof evidence, and keep multiple surface commands from colliding?

## Result

**Pass**, for page-level action/observation and screenshot evidence.

This does **not** prove isolated browser identities. cmux's current default browser surfaces share one WebKit browser profile/cookie jar.

## Live proof

Two browser surfaces were created in the same cmux workspace:

```text
surface:52
surface:53
```

Both independently supported:

- navigation;
- interactive accessibility snapshots and element refs;
- fill/click/eval;
- value and attribute reads;
- viewport screenshots;
- explicit surface targeting.

Page-state isolation check:

```text
surface:52 input = alpha-correct
surface:53 input = beta-correct

surface:52 main[data-done] = yes
surface:53 main[data-done] = null
```

Screenshot evidence was written successfully for both surfaces.

## Capability matrix observed

| Capability | Result |
|---|---|
| Navigate | Pass |
| Interactive snapshot | Pass |
| Fill/click | Pass |
| Eval | Pass |
| Read value/attribute | Pass |
| Screenshot | Pass |
| Explicit surface routing | Pass |
| Page/tab state non-collision | Pass |
| Persistent/shared auth profile | Present |
| Isolated browser identity per surface | Not proven; current default is shared-profile |
| CDP trace | `not_supported` on WKWebView |
| Screencast recording | `not_supported` on WKWebView |
| Network request capture | `not_supported` on WKWebView |

## Security observation

The cmux cookie command exposes the shared browser cookie jar, including sensitive session material. Raw cookie inspection is not needed for proof execution and must never be collected into Unsurf evidence or diagnostics by default.

No cookie values are copied into this result.

## Implementation graduated

An initial provider now exists at:

```text
src/skills/record/providers/cmux.ts
```

It:

- opens a cmux browser surface or targets an existing `surface:N`;
- implements Unsurf's BrowserHandle action/observation surface;
- declares provider capabilities explicitly;
- marks recording, tracing, and network capture unsupported;
- marks isolation as `shared-profile`;
- avoids closing a caller-owned surface by default;
- lets proof recording continue without attempting video when a provider declares `recording: false`.

Tests:

```text
test/cmux-provider.test.ts
```

## Decision

Use cmux as the canonical local interactive browser provider for the next experiment, subject to these rules:

1. Distinct surfaces are acceptable for independent exploratory page state.
2. Distinct surfaces are **not** sufficient evidence of fresh browser identity.
3. Fresh confirmation must use reset state, distinct profiles when available, run-scoped fixture state, or Browser Run sessions.
4. Local cmux proof bundles may contain snapshots/screenshots/action timelines without video.
5. Video is optional evidence; the reproducible proof is the artifact.
6. Keep Browser Run for hosted isolation, Live View, and native session recordings.

## Next gate

Proceed with the exp-014 fixture and investigator harness. Start with one cmux-backed proof replay to ensure the adapter returns usable evidence, then implement parallel investigator orchestration. Do not modify frozen `BRIEF.md` after the first investigator run begins.
