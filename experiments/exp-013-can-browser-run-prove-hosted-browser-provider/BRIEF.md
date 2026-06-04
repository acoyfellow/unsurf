# Question

Can Cloudflare Browser Run execute a minimal hosted Unsurf-shaped browser task end to end before we add a Browser Run provider to product code?

## Method

Build a disposable Worker with a Browser Run binding that:

1. launches a remote browser through `@cloudflare/puppeteer`,
2. navigates to a caller-supplied public URL,
3. reads the title and URL,
4. captures a screenshot byte count,
5. returns JSON proving those steps completed.

Run it against `https://unsurf.coey.dev` through a deployed disposable Worker. This is intentionally public/unauthenticated browsing only; it does not test user-session transfer or mp4 recording.

## Pass

- The Worker deploys with a Browser Run binding.
- A live request returns HTTP 200 JSON with:
  - normalized target URL,
  - browser page URL,
  - non-empty title,
  - positive screenshot byte count,
  - duration in milliseconds.

## Fail

- Browser Run binding cannot launch from the Worker,
- remote navigation cannot load a normal public site,
- screenshot capture fails,
- or the live Worker cannot complete within a practical timeout.

## Output

- `src.ts`
- `wrangler.jsonc`
- `RESULT.md` with exact live proof response and graduation recommendation.
