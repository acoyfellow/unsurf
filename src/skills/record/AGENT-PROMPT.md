# Agent prompt: record a local video (no upload)

Drop-in prompt block for handing to another agent (pi / opencode / claude / cursor) when you want them to produce a **local `.webm` or `.mp4`** of a browser flow using unsurf, **without** touching the hosted `trace.coey.dev` pipeline.

A matching pi/opencode/claude **skill** lives at `~/.agents/skills/unsurf-record-video/SKILL.md` on Jordan's machine. This file is the version-controlled copy that travels with the package and shows up on GitHub + npm.

## Copy-paste this to the other agent

````
Use the `unsurf` npm package to record a browser session to a local file.
Do NOT use the hosted trace.coey.dev flow — I only want the video bytes on disk.

## Setup

```bash
npm i unsurf                    # unsurf >=0.3.0
npm i -g agent-browser          # owns Chrome + the webm encoder
agent-browser install           # downloads Chromium if none on PATH
```

## Recipe

```ts
import { openLocalBrowser } from "unsurf/skills/record";

const browser = await openLocalBrowser();
const out = "./my-recording.webm";

await browser.startRecording(out);
try {
  await browser.goto("https://example.com");
  await browser.wait(500);
  // … your steps …
} finally {
  await browser.stopRecording();
  await browser.close();
}

console.log(`wrote ${out}`);
```

## Rules

1. Import `openLocalBrowser` from `unsurf/skills/record` — NOT `record` or
   `recordLocal`. Those trigger the hosted upload path and require
   `TRACE_INGEST_TOKEN`.
2. Always wrap steps in `try { … } finally { await browser.stopRecording();
   await browser.close(); }`. If you skip this and something throws, the
   webm is truncated.
3. No env vars are needed for this path. If the code complains about
   `TRACE_INGEST_TOKEN`, you imported the wrong function.
4. Output is silent VP8 `.webm` by default. Convert to `.mp4` only if I
   explicitly ask:
   ```bash
   ffmpeg -i my-recording.webm -c:v libx264 -pix_fmt yuv420p my-recording.mp4
   ```

## BrowserHandle surface

- `goto(url)` — navigate + wait for load
- `click(selector)` — click CSS-selected element
- `fill(selector, value)` — clear + type
- `wait(ms)` or `wait({ selector, timeoutMs })` — sleep or wait for element
- `snapshot()` — DOM/a11y snapshot (opaque JSON)
- `screenshot()` — PNG bytes
- `startRecording(path)` / `stopRecording()` — bracket the recorded window
- `close()` — release Chrome session

Prefer stable selectors: `input[name="…"]`, `aria-label`, `id`. Avoid
`:nth-child`.
````

## When to use which unsurf path

| Goal | Use |
|---|---|
| Just give me the video file on disk | `openLocalBrowser` (this doc) |
| Shareable URL + video + step trace + receipt | `recordLocal` from `unsurf/skills/record` |
| Record, watch the video, iterate against a North Star | `loop` from `unsurf/skills/loop` |

## Related

- `src/skills/record/README.md` — the full record skill (hosted path)
- `src/skills/loop/README.md` — the agent self-iteration loop
- `~/.agents/skills/unsurf-record-video/SKILL.md` — the installable skill pi/opencode/claude auto-load
