# skills/loop

```
spec → record → observeVideo → met? → refine → record → … until done
```

Close the agent loop. Hand in a goal and a North Star; `loop()` drives
a real browser, watches its own recording, and iterates until the
North Star is met or the budget runs out.

**Status:** 0.3 — orchestrator shipped; composes on top of `record` and
`observe-video` with pluggable backends for every stage.

## Quick use

```ts
import { loop } from "unsurf/skills/loop";

const result = await loop({
  spec: "Go to httpbin.org/forms/post and fill the customer name, telephone, and email fields",
  northStar: "Did the user fill all three text fields with non-empty values?",
  maxIterations: 3,
});

console.log(result.met);          // true
console.log(result.stopReason);   // "met"
for (const t of result.iterations) {
  console.log(t.iteration, t.met, t.traceUrl, t.answer);
}
```

Or from the CLI:

```bash
unsurf loop "open coey.dev, click projects, open the first one" \
  --north-star "Did the user end up on a project detail page?" \
  --max-iter 3
# each iteration uploads a grant-gated trace (private by default; pass
# --public for a 365-day shareable grant)
```

## The mental model

- **Spec** = what to do. Either a natural-language string (synthesized
  into a structured spec by the planner) or a `LoopSpec` object
  (`{ url?, steps[], notes? }`) with data-only ops. No code, no eval.
- **North Star** = what "done" looks like. Phrased as a yes/no question
  so "met" is unambiguous.
- **Refiner** = what to try when a recording doesn't meet the North
  Star. Receives `{ previousSpec, previousAnswer, confidence, iteration }`
  and returns a new spec — or `{ giveUp: true }`.

Each iteration emits its own trace bundle. You can scrub them after
the run in `result.iterations[*].traceUrl`.

## Safeguards

- **Tick budget** — default 120s per iteration. Exceed it and the tick
  errors out instead of hanging.
- **Error budget** — 3 consecutive errors → `stopReason: "errorBudget"`.
- **Met detection** — requires both confidence `>= minConfidence`
  (default 0.7) *and* an affirmative answer pattern. A model that
  hedges with low confidence is treated as not-met.

## Requirements

Same as `record` + `observe-video` combined:

- `agent-browser` on PATH (recording).
- `ffmpeg` + `ffprobe` on PATH (observe).
- `TRACE_INGEST_TOKEN` env (upload).
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Workers AI).

## Swapping the four backends

Every step is a plain interface that defaults to a Workers AI
implementation. Override any of them:

```ts
await loop({
  spec, northStar,
  planner:     { async plan({ goal, northStar }) { /* … */ } },
  refiner:     { async refine({ previousSpec, previousAnswer, … }) { /* … */ } },
  recordFn:    async ({ task, run }) => { /* custom upload destination */ },
  observeFn:   async ({ video, question }) => { /* custom vision stack */ },
});
```

`planner` is only consulted when `spec` is a string. `refiner` is only
consulted between iterations.

## Files

| File          | Purpose                                               |
|---            |---                                                    |
| `index.ts`    | Public entry: `loop`, backend factories, types.       |
| `types.ts`    | `LoopOptions`, `LoopSpec`, `LoopStep`, backend ifaces. |
| `interpret.ts`| `validateSpec` + `runSpec` (pure-data step walker).    |
| `backends.ts` | Kimi K2.6 planner/refiner, default record/observe.    |
| `loop.ts`     | Orchestrator: tick budget, error budget, met check.   |
