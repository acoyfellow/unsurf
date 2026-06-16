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

The deterministic run opens four discovery surfaces concurrently, promotes the strongest observed candidate, and executes three broken plus three fixed confirmation runs in fresh surfaces.

For the real agent-discovery gate, provide Workers AI credentials and run:

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... bun run run:agents
```

This asks four independent Workers AI investigators—each receiving only its role, the vague symptom, target URL, and bounded browser action vocabulary—to generate strategies concurrently. Generated strategies are then executed in separate cmux surfaces. Only observed candidates enter the unchanged deterministic 3+3 confirmation gate.

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

The fixture is deliberately small and deterministic. The default run validates orchestration and evidence mechanics. `run:agents` additionally tests unknown-path strategy discovery, but still does not represent full real-world bug complexity.

## Proof policy

A candidate is promoted only when:

1. discovery observes the unwanted final state;
2. 3/3 fresh broken replays reproduce it;
3. 3/3 fresh fixed replays do not reproduce it and remain complete.

A cmux surface isolates page state, but the current Default browser profile is shared. Never treat a fresh surface as a fresh browser identity without explicit state normalization.
