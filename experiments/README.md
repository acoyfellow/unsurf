# unsurf experiments — WebMCP capture branch

Parallel, disposable experiments exploring one question:

> **Can unsurf's scout/worker/heal loop be extended to capture WebMCP tools from any webpage — synthesizing them on the fly, running them via a safe DSL, and caching them in the Directory — so agents can act on sites that have no WebMCP support and no backend API?**

This is the "second capture strategy" for unsurf. Today unsurf captures **API calls** (network-level) and replays them as typed endpoints. These experiments test whether unsurf can *also* capture **page-level actions** (DOM-level) and replay them as typed WebMCP tools.

Same loop, different capture.

## How this folder works

Each `exp-NNN-<slug>/` answers exactly one question. Each has a `BRIEF.md` stating Question / Method / Kill-by / Output / Integration target. Experiments are time-boxed, disposable, and composed via **one shared artifact format**: `tool-spec.v0.json` (see `CONTRACT.md`).

Rules for every experiment:

1. **One question.** Stated in the BRIEF's first line.
2. **Pass / Fail / Ambiguous.** No other results.
3. **Kill-by is load-bearing.** When time's up, write up what you have. A good "Fail" beats a sprawling "Success."
4. **No shared code yet.** Each experiment can install whatever it wants. Don't refactor into shared utils until three experiments want the same thing.
5. **Compose via the contract.** If your experiment produces or consumes `tool-spec.v0.json`, use the schema in `CONTRACT.md` verbatim. No additions.
6. **Side questions go in `BACKLOG.md`.** Don't chase them mid-experiment.

## Graduation path

Experiments that pass move into unsurf proper:

| Experiment kind | Graduates to |
|---|---|
| Synthesizer backends | `src/ai/` alongside `ScoutAgent.ts` |
| Tool runner / DSL | `src/tools/` alongside `Worker.ts` |
| Directory schema additions | `src/services/Directory.ts` + `src/db/schema.ts` |
| Browser / DOM extraction | `src/services/Browser.ts` |
| Fingerprinting strategies | `src/domain/Fingerprint.ts` |
| Extension / client code | new package in `examples/` or sibling repo |

Failed experiments stay as evidence in `experiments/` until archived. The learnings live in the BRIEFs regardless.

## Relationship to existing unsurf concepts

| Existing unsurf | WebMCP-capture equivalent |
|---|---|
| `src/tools/Scout.ts` — captures network events → endpoints | a **DomScout** that captures DOM/forms/actions → tool specs |
| `src/services/SchemaInferrer.ts` — infers JSON schemas from API bodies | reused verbatim for tool input schemas |
| `src/services/OpenApiGenerator.ts` — endpoints → OpenAPI | sibling **ToolCatalogGenerator** — specs → MCP tool manifest |
| `src/tools/Worker.ts` — replays captured API calls | a **DomWorker** that executes tool spec DSL via DOM |
| `src/tools/Heal.ts` — re-scouts changed APIs | reused as-is; heal for DOM is just re-scout with DomScout |
| `src/services/Directory.ts` — shared registry of scouted paths | extended to hold tool spec catalogs alongside API paths |
| `src/domain/Fingerprint.ts` — URL + request pattern hash | extended with DOM-structure fingerprinting |

The business model stays identical: self-host free, hosted instance at `unsurf-api.coey.dev` pays for Browser Rendering, Workers AI fallback, and the shared Directory.

## Layout

```
experiments/
├── README.md          ← this file
├── CONTRACT.md        ← tool-spec.v0.json schema (write-once, never modified by experiments)
├── BACKLOG.md         ← parking lot for side questions
├── exp-001-.../BRIEF.md
├── exp-002-.../BRIEF.md
...
└── exp-012-.../BRIEF.md
```

Root of unsurf is unchanged on this branch except for this folder. No `src/` changes until an experiment graduates.

## Running an experiment

1. Read `CONTRACT.md` (required).
2. Read your `BRIEF.md`.
3. Work inside your `exp-NNN-<slug>/` folder.
4. When kill-by hits, write `RESULT.md` in the same folder with: Result (Pass/Fail/Ambiguous), What I learned (one paragraph), Surprises (one paragraph), Graduation recommendation (merge into unsurf as…? defer? abandon?).
5. Don't touch anything outside your folder.

## Freeze rule

BRIEFs are frozen at the commit before the first run of their experiment. Once an experiment has started executing, its BRIEF.md is read-only — no post-hoc edits to Pass/Fail/Ambiguous criteria, no retroactive scope changes, no sliding goalposts. If the framing turns out wrong, the honest move is: write the RESULT.md against the original criteria, open a BACKLOG.md entry for the improved framing, and spawn a new exp-NNN-<slug> folder for the next attempt. Do not edit the original in place.

THESIS.md (branch-level gating) follows the same rule.

## Why a branch, not a repo

unsurf already has the directory service, Browser Rendering integration, D1/R2 storage, Effect-based service pattern, MCP endpoint, and deployment. Rebuilding any of that in a fresh repo would be a tax. Expanding unsurf's capture strategies is exactly what "permanently 0.0.1" means — one thin repo, more things it can capture.
