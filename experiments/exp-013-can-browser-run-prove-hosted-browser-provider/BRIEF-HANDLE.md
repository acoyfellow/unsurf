# Question

Can a Cloudflare Browser Run adapter satisfy Unsurf's core browser-handle verbs in a hosted Worker before we productize a `browser-run` provider?

## Method

Extend the disposable Browser Run Worker with a local `BrowserHandle`-shaped adapter over Puppeteer that implements:

- `goto`
- `wait`
- `snapshot`
- `screenshot`
- `close`

Expose `/handle-proof?url=...` to run those verbs in order against a public page and return structured JSON proving each part completed.

## Pass

A live request against `https://unsurf.coey.dev` returns HTTP 200 JSON with:

- `ok: true`
- target URL and final page URL
- non-empty title from snapshot material
- positive screenshot byte count
- ordered operation list proving `goto`, `wait`, `snapshot`, and `screenshot`

## Fail

- the adapter cannot map cleanly to Browser Run Puppeteer,
- one of the core verbs fails live,
- or the proof only works through ad hoc Worker logic that would not resemble a real provider.

## Output

- adapter code in `browser-handle.ts`
- extended proof Worker route in `src.ts`
- `RESULT-HANDLE.md` with live response and graduation recommendation.
