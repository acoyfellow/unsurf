# Result: Pass

A disposable Browser Run adapter can satisfy Unsurf's core read/inspect browser verbs in a hosted Worker.

## Live proof

Endpoint:

- `https://unsurf-browser-run-proof.coy.workers.dev/handle-proof?url=https%3A%2F%2Funsurf.coey.dev`

Live response:

```json
{
  "ok": true,
  "target": "https://unsurf.coey.dev/",
  "pageUrl": "https://unsurf.coey.dev/",
  "title": "unsurf | unsurf",
  "textPreview": "Skip to content\nunsurf\nDirectory\nunsurf\nGive agents a real authenticated browser — and get back proof....",
  "screenshotBytes": 159714,
  "ops": ["goto", "wait", "snapshot", "screenshot"],
  "durationMs": 5725
}
```

Control response against `example.com` also passed with the same operation sequence in 5805ms.

## What this proves

- A Browser Run-backed handle can implement the Unsurf-shaped operations:
  - `goto`
  - `wait`
  - `snapshot`
  - `screenshot`
  - `close`
- The adapter shape is provider-like rather than Worker-specific glue.
- The hosted path is viable for public/non-authenticated browsing and artifact capture.

## What remains unproven

- `click` / `fill` parity,
- recording/video provider behavior,
- auth/session transfer,
- and product integration with the existing `BrowserHandle` types in `src/skills/record`.

## Graduation recommendation

Graduated into product code after follow-up proof:

- `openBrowserRunBrowser(...)` now ships in `src/skills/record/providers/browser-run.ts`.
- Live `/form-proof` passed against `https://httpbin.org/forms/post` using the product provider with operations `goto`, `fill`, `waitFor`, `snapshot`, and `screenshot`.
- `recordBrowserRunSession(...)` now enables Browser Run native rrweb session recording and returns the finalized session ID after browser close.

Native Browser Run recordings are replay events, not playable MP4/WebM artifacts. Pixel-video capture remains separate from this graduation.
