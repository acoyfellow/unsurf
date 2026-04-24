# skills/observe-video

```
video + question → { answer, confidence, evidenceFrames }
```

Watch a recorded browser session and answer a natural-language question
about it. Extracts scene-change keyframes with ffmpeg, captions each with
a vision model, and synthesizes a structured answer with a text model.

**Status:** 0.3 — runs locally against Workers AI; backends are pluggable.

## Quick use

```ts
import { observeVideo } from "unsurf/skills/observe-video";

const result = await observeVideo({
  video: "https://trace.coey.dev/r/abc123xyz000/video.webm?exp=…&sig=…",
  question: "Did the user submit the form?",
});

console.log(result.answer);       // "No, the user filled three fields but never…"
console.log(result.confidence);   // 1.0
```

Accepts a local file path or an `http(s)` URL (it will download to a
temp file, run the pipeline, and clean up).

## Requirements

- `ffmpeg` and `ffprobe` on PATH (scene-change extraction + probing).
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` env vars (token
  needs `Workers AI - Read`).

## Defaults

| Concern   | Default                                      | Why                                    |
|---        |---                                           |---                                     |
| Vision    | `@cf/google/gemma-3-12b-it`                  | Native multimodal, no license gate.    |
| Synthesis | `@cf/moonshotai/kimi-k2.6`                   | Frontier reasoning, strict JSON.       |
| Max frames| 8                                            | Budget-friendly; scene-pads if needed. |
| Threshold | 0.3                                          | Human-perceptible scene changes.       |

Synthesis uses Workers AI's `response_format: { type: "json_schema" }`
so the runtime — not the prompt — guarantees the return shape. The skill
is model-agnostic by design.

## Swapping backends

```ts
import { observeVideo, workersAiVisionBackend, workersAiSynthesisBackend }
  from "unsurf/skills/observe-video";

await observeVideo({
  video: "./tour.webm",
  question: "…",
  visionBackend: workersAiVisionBackend({ model: "@cf/mistralai/mistral-small-3.1-24b-instruct" }),
  synthesisBackend: workersAiSynthesisBackend({ model: "@cf/meta/llama-4-scout-17b-16e-instruct" }),
});
```

Or write your own implementing `VisionBackend` / `SynthesisBackend`
from `./types.ts`. No other part of the skill cares.

## Files

| File              | Purpose                                                       |
|---                |---                                                            |
| `index.ts`        | Public entry: `observeVideo`, backend factories, types.       |
| `types.ts`        | `ObserveOptions`, `ObserveResult`, backend interfaces.        |
| `frames.ts`       | `extractFrames` + `probeDurationMs` (ffmpeg shell-outs).      |
| `observe.ts`      | Orchestrator: download → extract → caption → synthesize.      |
| `backends/workers-ai.ts` | Default Workers AI vision + synthesis backends.         |

## Composed by

- `skills/loop` — watches each iteration's video and decides whether the
  North Star is met before deciding to refine.
