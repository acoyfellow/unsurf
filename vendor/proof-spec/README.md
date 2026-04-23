# @acoyfellow/proof-spec

Shared types for `proof-spec.v0`. Used by unsurf, gateproof, trace, lab.

```
observe → act → assert
```

One schema. Three usage modes (tool / gate / proof). Zero runtime dependencies.

## Install

```bash
bun add @acoyfellow/proof-spec
```

## Use

```typescript
import type { ProofSpec, EvidenceBundle } from "@acoyfellow/proof-spec";
import { computeRisk } from "@acoyfellow/proof-spec";

const spec: ProofSpec = {
	version: "v0",
	target: { url: "https://example.com" },
	name: "demo",
	description: "clicks a button",
	inputSchema: { type: "object", properties: {} },
	act: [{ op: "click", target: { role: "button", name: "Submit" } }],
	risk: computeRisk([{ op: "click", target: { role: "button", name: "Submit" } }]),
};
```

## What's in the package

| File | Exports |
|---|---|
| `spec.ts` | `ProofSpec`, `Target`, `ElementTarget`, `Observation`, `DslOp`, `Assertion`, `Loop`, `Risk`, `Provenance`, `AriaRole` |
| `evidence.ts` | `EvidenceBundle`, `ObservationResult`, `ActionResult`, `AssertionResult`, `Status` |
| `risk.ts` | `computeRisk(act) -> Risk` |
| `index.ts` | re-exports |

## What's not in the package

Kept out deliberately:

| Concern | Lives in |
|---|---|
| `ProofRunner` interface | per-runner (unsurf, gateproof) |
| Executor code | `unsurf/src/services/Plan.ts` |
| Scorer rubrics | `unsurf/src/domain/JudgeScorers.ts` |
| Workers AI defaults | unsurf (runner-specific) |

The package is types + one pure function. Nothing that needs to version with a runtime.

## Consumers

| Package | Imports |
|---|---|
| [unsurf](https://github.com/acoyfellow/unsurf) | spec + evidence + risk |
| [gateproof](https://github.com/acoyfellow/gateproof) | spec + evidence + risk |
| `unsurf/skills/record` (trace) | `EvidenceBundle` for `result.json.evidence` |
| [lab](https://lab.coey.dev) | structural reference to `result.json` shape |

## Version

`v0` is frozen. Breaking shape changes go to `v1` in a new package (no breaking bumps inside `v0`).

## License

MIT
