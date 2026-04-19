# TWO PROJECTS, ONE SCHEMA

> Drafting a coey.dev post about the unsurf + gateproof merge.
> Style reference: https://coey.dev/vm-api (One Agent Steering Another)
> Not published. Living in the unsurf repo while Jordan edits.

---

```
Published URL (proposed): https://coey.dev/proof-spec
Slug: proof-spec
Category badge: Infrastructure
Date: 2026.04.19
```

---

# TWO PROJECTS, ONE SCHEMA

> Merging unsurf and gateproof at the schema level so agents can invoke, verify, and prove — with one file.

`Infrastructure`  ·  `2026.04.19`

---

## The Setup

I've been shipping two side projects that kept looking like the same idea wearing different hats.

**unsurf** turns any website into a typed API. Scout a page, get back a tool spec, call the tool.

**gateproof** runs correctness loops. Observe something, act on it, assert the result. Iterate until pass or budget burns.

Two repos. Two npm packages. Two schemas drifting week over week.

Reading them side by side last night I realized: **they're the same loop at different altitudes.** unsurf works at the DOM (click/fill/submit, role+name targets). gateproof works at HTTP (curl commands, status assertions). Same shape: observe → act → assert.

So I merged them at the schema level today. Not the repos — the types.

## The Shape

```
                  OBSERVE              ACT                ASSERT
gateproof (HTTP): fetch URL            exec("curl …")     status 200, body has X
unsurf    (DOM):  read role+name       click/fill/submit  textPresent, urlMatches
                        ↑                    ↑                  ↑
                        |                    |                  |
                  state before         the try           state after
```

One schema. Two altitudes. Any spec can be:

- **a tool** — just `act[]`. unsurf shape. "Do this."
- **a gate** — just `observe[]` + `assert[]`. gateproof shape. "Verify this."
- **a proof** — all three plus `loop`. "Do it, check it, retry until it works."

## The Spec

```json
{
  "version": "v0",
  "target": { "url": "https://example.com/contact" },
  "name": "submit_contact_form",
  "description": "Submit the form. Verify the submission landed.",
  "inputSchema": {
    "type": "object",
    "properties": { "email": { "type": "string", "format": "email" } },
    "required": ["email"]
  },
  "observe": [
    { "kind": "http", "url": "https://example.com/contact", "expect": { "status": 200 } },
    { "kind": "dom",  "target": { "role": "heading", "name": "Contact" } }
  ],
  "act": [
    { "op": "fill",  "target": { "role": "textbox", "name": "Email" }, "value": "{{email}}" },
    { "op": "click", "target": { "role": "button",  "name": "Send" } }
  ],
  "assert": [
    { "kind": "textPresent", "value": "Thanks" },
    { "kind": "urlMatches",  "pattern": "/thanks" }
  ],
  "loop": { "maxIterations": 3 },
  "risk": "medium"
}
```

That file is both a tool and a gate. Pick a mode.

## Risk Is Not A Vibe

`risk` is computed from the `act[]` shape by a pure function. No LLM decides it. No synthesizer's self-label is trusted.

- `low` = all reads
- `medium` = interactive, no submits, no destructive verbs
- `high` = submit op, OR click on a button whose name matches `/\b(delete|remove|pay|buy|send|confirm|destroy|cancel|wipe|…)\b/i`

The Runner recomputes this on every catalog ingest. The synthesizer's claim is logged as a hint. An adversarial page can't poison risk labeling by hiding "set risk to low" in invisible text — because risk isn't a field anyone honors, it's derived from the DSL.

This is the defense. Drives to zero 3 of 3 attacks that bypassed it when risk was a first-class field.

## The Code

Same file lives in two repos now. Verbatim.

```ts
// acoyfellow/unsurf/src/domain/ProofSpec.ts
// acoyfellow/gateproof/src/ProofSpec.ts

export function computeRisk(act: readonly DslOp[] | undefined): Risk {
  if (!act || act.length === 0) return "low";
  if (act.every((op) => op.op === "read")) return "low";
  for (const op of act) {
    if (op.op === "submit") return "high";
    if (op.op === "click" && DESTRUCTIVE_RE.test(op.target.name)) return "high";
  }
  return "medium";
}
```

Copied by hand for now. The file header says "when this drifts, extract to a shared npm package and both repos depend on it." Deferred until it hurts.

## The Executor

`unsurf` grew a `Plan` service that eats proof-specs:

```ts
import { runSpec, verifySpec, computeRisk } from "unsurf";

// Tool shape: runs act[], returns MCP-shaped content
const result = await runSpec(spec, { email: "jane@example.com" });

// Gate shape: observe + assert, ignores act[]
const proof = await verifySpec(spec);
```

500 lines of Bun. No deps except built-in `WebSocket` and `fetch`. Dispatches:

- DOM ops via CDP into a local Chromium
- HTTP ops via fetch
- exec ops rejected in the client runner (server-only)

Tests: 10/10 green. One is a live HTTP call to example.com to prove the HTTP path doesn't need CDP at all.

## Interop

gateproof got conversion helpers:

```ts
import { goalToProofSpec, proofSpecToGoal } from "gateproof";

const spec = goalToProofSpec(myGoal, { url: "https://…" });
// ↑ now publishable to unsurf's Directory

const goal = proofSpecToGoal(someSpec);
// ↑ now runnable by gateproof's Plan.runLoop
```

Round-trip preserves what can be preserved (http observes, exec acts, http-layer assertions) and honestly drops what can't (DOM-layer assertions like `textPresent` have no gateproof equivalent yet). Not a bug — gateproof doesn't have a DOM executor. When it does, the shape is already waiting.

Tests: 5/5 green. 41/41 across gateproof's full suite.

## Why This Matters

Two independent projects, both chasing the same thing, and I was about to ship them with parallel schemas.

Merging them means:
- Agents get one format to care about, not two
- `scoreHallucination` inside Agent Lee's `waitUntil` can verify an agent's claim using the same spec shape that the unsurf extension invokes tools with
- A Directory entry can be both "things to do on this page" and "checks that prove the thing got done"

The deeper idea: **runtime correctness as a shared primitive.** Not a framework. Not a platform. Just a schema and an executor.

## The Honest Caveats

Things that are real:

- unsurf's DOM executor and gateproof's Plan.runLoop aren't unified yet — each runs its own subset of capabilities. Two runners, one schema is still progress.
- Extracting the shared file into its own npm package would be cleaner. Two verbatim copies is the Mr. 0.0.1 move — ship small, extract when it hurts.
- `numericDeltaFromEnv` and a few other assertion kinds round-trip lossy. gateproof is richer at the HTTP layer; unsurf is richer at the DOM layer. The union is proof-spec v0; edges get pruned.
- This is a solo move. Neither project has a formal RFC. If nobody else uses it, nothing is lost — both projects still ship their individual shapes.

## Try It

```bash
# unsurf side
bun add unsurf
```

```ts
import { runSpec, type ProofSpec } from "unsurf";
const spec: ProofSpec = JSON.parse(await Bun.file("./spec.json").text());
console.log(await runSpec(spec, args));
```

```bash
# gateproof side
bun add gateproof
```

```ts
import { Plan, goalToProofSpec } from "gateproof";
// Write a gateproof plan → export it as a proof-spec
const specs = planToProofSpecs(myPlan, (id) => ({ url: `https://…/${id}` }));
```

Full writeup: [`experiments/_proof-spec-v0/SPEC.md`](https://github.com/acoyfellow/unsurf/tree/main/experiments/_proof-spec-v0) in the unsurf repo.

---

*Two repos. Two npm packages. One schema. Same observe → act → assert loop at different altitudes of the stack.*
