# Exp-014 result — deterministic harness pass

Date: 2026-06-16

## Verdict

The first executable gate **passes** with cmux as the local interactive browser provider:

- four investigators ran concurrently in separate cmux browser surfaces;
- two independently found the delayed continuation;
- one lifecycle/reload path was promoted;
- three fresh broken replays reproduced it;
- three fresh fixed replays remained complete;
- each confirmation produced screenshot evidence plus a machine-readable result.

This proves the harness mechanics and provider path. It does **not yet** prove that unconstrained AI investigators can discover an unknown path from only the vague symptom; the current investigators are deterministic causal strategies. That remains the next product-level gate.

## Symptom shown to the harness

> The response looked complete, but then it continued unexpectedly.

## Promoted repro

1. Open the target.
2. Start a response.
3. Wait until the UI reports `complete`.
4. Reload immediately.
5. Wait 2.6 seconds.
6. Observe whether state changes from `complete` to `resumed`.

## Confirmation

| Target | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| Broken | reproduced | reproduced | reproduced |
| Fixed | stayed complete | stayed complete | stayed complete |

Observed state timelines:

```text
broken: complete → resumed → resumed
fixed:  complete → complete → complete
```

## Evidence

```text
out/result.json
out/evidence/broken-1.png
out/evidence/broken-2.png
out/evidence/broken-3.png
out/evidence/fixed-1.png
out/evidence/fixed-2.png
out/evidence/fixed-3.png
```

`out/result.json` records hypotheses, strategies, promotion, every state timeline, screenshot paths, and gate outcomes.

## Isolation caveat

Each replay used a newly created cmux surface and a unique fixture URL. cmux's current Default WebKit profile is shared across surfaces, so the fixture explicitly normalizes its own session state. This is sufficient for this controlled proof but is not equivalent to isolated browser identities.

## Reproduce

Terminal 1:

```bash
cd experiments/exp-014-can-parallel-browser-investigators-discover-and-confirm-a-repro
bun fixture/server.ts
```

Terminal 2:

```bash
bun run run:cmux
```

Expected terminal condition:

```text
PASS: 3/3 broken reproduced and 3/3 fixed stayed complete.
```

## Next gate

Replace deterministic strategy definitions with four genuinely independent browser investigators receiving only:

- the vague symptom;
- target URL;
- evidence budget;
- stop condition.

Keep deterministic replay and the 3+3 promotion gate unchanged. An AI-generated candidate must compile to the same small replay step format before it can be promoted.
