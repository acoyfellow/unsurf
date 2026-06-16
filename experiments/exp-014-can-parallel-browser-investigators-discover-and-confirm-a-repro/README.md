# Exp-014: Parallel discovery, independent confirmation

Turns a vague browser symptom into a replayable candidate, then confirms it against broken and fixed targets.

## Quick start

Requires cmux with its in-app browser available.

```bash
# terminal 1
bun fixture/server.ts

# terminal 2
bun run run:cmux
```

The run opens four discovery surfaces concurrently, promotes the lifecycle/reload candidate, and executes three broken plus three fixed confirmation runs in fresh surfaces.

## Outputs

- `out/result.json` — machine-readable discovery and confirmation receipt
- `out/evidence/*.png` — final-state screenshots for all six confirmations
- `RESULT.md` — reviewer-readable result
- `CMUX-PROVIDER-RESULT.md` — provider prerequisite and capability caveats

Generated `out/` artifacts are intentionally gitignored. Run the command to produce a fresh receipt.

## Fixture

- `/broken` schedules a delayed continuation after initially reporting complete.
- `/fixed` remains complete through the same lifecycle/reload sequence.
- `/health` supports harness readiness checks.

The fixture is deliberately small and deterministic. It validates orchestration and evidence mechanics, not real-world bug complexity.

## Proof policy

A candidate is promoted only when:

1. discovery observes the unwanted final state;
2. 3/3 fresh broken replays reproduce it;
3. 3/3 fresh fixed replays do not reproduce it and remain complete.

A cmux surface isolates page state, but the current Default browser profile is shared. Never treat a fresh surface as a fresh browser identity without explicit state normalization.
