# Result: Pass

Browser Run can support a hosted Unsurf-style browser provider for public/non-authenticated browser work.

## Live proof

Disposable Worker:

- `https://unsurf-browser-run-proof.coy.workers.dev`

Live proof responses from 2026-05-21:

```json
{
  "ok": true,
  "target": "https://example.com/",
  "pageUrl": "https://example.com/",
  "title": "Example Domain",
  "screenshotBytes": 16894,
  "durationMs": 4135
}
```

```json
{
  "ok": true,
  "target": "https://unsurf.coey.dev/",
  "pageUrl": "https://unsurf.coey.dev/",
  "title": "unsurf | unsurf",
  "screenshotBytes": 144850,
  "durationMs": 4947
}
```

Session history after the successful requests showed the two latest Browser Run sessions closing with `NormalClosure`, not idling out.

## Important surprise

The repo's existing `@cloudflare/puppeteer@1.0.6` build was not a valid Browser Run proof substrate today: `puppeteer.launch(env.BROWSER)` created sessions that then idled out while the Worker timed out waiting for launch.

The same proof passed immediately in an isolated experiment package using the current documented `@cloudflare/puppeteer@1.1.0` plus Wrangler 4.93.1.

That means any productization should include a Puppeteer version bump or a dedicated compatibility check, not simply copy the provider shape into current Unsurf as-is.

## What this proves

- Browser Run Worker binding is usable in Jordan's personal Cloudflare account.
- A Worker can launch a hosted browser, navigate a public target, set a narrow viewport, capture a screenshot, and return structured JSON.
- Explicit close handling works and prevents leaked idle sessions in the happy path.

## What this does not prove

- authenticated user-session transfer from local cmux into Browser Run,
- mp4 recording or screencast stitching,
- loop-provider parity,
- Durable Object session reuse,
- or a product-ready Unsurf `BrowserHandle` provider.

## Graduation recommendation

Graduate to the next bounded proof, not directly to product code:

1. add a Browser Run `BrowserHandle` adapter in an isolated harness,
2. prove the Unsurf verbs (`goto`, `wait`, `snapshot`, `screenshot`) against it,
3. decide whether video proof should use screencast frames + stitching or remain local-only,
4. then add `browser-run` as an optional Unsurf provider.
