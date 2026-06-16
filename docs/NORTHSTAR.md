# Unsurf North Star

> Unsurf turns browser-agent claims into independently replayed, evidence-backed proof.

## The product is reproducible proof

A browser agent saying “I reproduced it” is not evidence. Unsurf discovers a candidate path, compiles it to a portable repro, and confirms it in fresh runs against broken and fixed targets.

The canonical local invocation is:

```bash
unsurf investigate \
  --symptom "The response looked complete, then continued" \
  --broken "$BASELINE_URL" \
  --fixed "$CANDIDATE_URL"
```

A successful run returns:

```text
✓ Candidate observed
✓ Broken reproduced 3/3
✓ Fixed reproduced 0/3

Repro:  .unsurf/runs/<id>/repro.json
Report: .unsurf/runs/<id>/report.md
```

## Evidence is capability-driven

Required:

- a portable action and assertion contract;
- deterministic independent replay;
- machine-readable results;
- explicit provider and isolation semantics.

Optional, depending on the provider:

- screenshots and snapshots;
- video;
- browser session replay;
- traces and network logs.

Video remains excellent evidence where it exists, but it is not the product contract. A provider must never claim evidence it cannot produce.

## Providers

| Provider | Best use | Isolation | Evidence |
|---|---|---|---|
| cmux browser | Local authenticated exploration and confirmation | Shared browser profile unless explicitly configured otherwise | Snapshots, screenshots, assertions, timelines |
| Browser Run | Hosted/public/scalable confirmation | Isolated hosted sessions | Snapshots, screenshots, rrweb session recording |
| Attached Chrome | Legacy/local playable recording | Depends on selected profile | Video, snapshots, screenshots, timelines |

A fresh cmux surface is separate page state, not automatically a fresh browser identity. Unsurf reports that distinction instead of hiding it.

## Canonical workflow

1. Receive a vague symptom and target URLs.
2. Run several causal investigators independently.
3. Promote only a candidate that actually observes the symptom.
4. Serialize it as `repro.json`.
5. Re-run it at least three times against the broken target.
6. Re-run it at least three times against the fixed candidate.
7. Produce a reviewer-readable report and machine receipt.

## Working agreement

- No “looks like it should work.” Execute it.
- Model prose is not confirmation.
- Distinct discovery and confirmation runs are mandatory.
- Provider capabilities and isolation are visible in every receipt.
- Sensitive browser state such as raw cookies is never collected as evidence.
- Keep local authenticated interaction and hosted isolated execution interchangeable behind explicit provider capabilities.
