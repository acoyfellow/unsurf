# skills/record

```
agent runs → video + receipt → shareable URL
```

Record any agent browser run. Returns a canonical URL: video, step trace, receipt.

**Status:** 0.0.1 — local provider + HTTP ingest + viewer Worker all live.
Hosted at `https://trace.coey.dev/r/:id`.

## Quick use

```ts
import { recordLocal } from "unsurf/skills/record";

const result = await recordLocal({
	task: "verify the stratus sidebar happy path",
	run: async (browser) => {
		await browser.goto("https://localhost:7445");
		await browser.fill("textarea", "What DNS records do I have?");
		await browser.click("button[aria-label='Send']");
		await browser.wait({ selector: "[data-message-role='assistant']" });
	},
});

console.log(result.url); // https://trace.coey.dev/r/abc123xyz000
```

Or from the CLI:

```bash
export TRACE_INGEST_TOKEN=...       # copy from the Worker secret
bunx unsurf record ./examples/record-demo.ts --task "demo"
```

**Requirements:** `agent-browser` on PATH, `TRACE_INGEST_TOKEN` env.

## Files in this folder

| File | Purpose |
|---|---|
| `index.ts` | Public entry: `record`, `recordLocal`, constants, type exports. |
| `types.ts` | Type surface. `BrowserHandle`, `RecordOptions`, bundle shapes. |
| `id.ts` | Canonical 12-char base36 id generator. |
| `tracer.ts` | `traceHandle()` — Proxy-based step collector around any `BrowserHandle`. |
| `record.ts` | `record()` — orchestration (open → record → run → stop → upload). |
| `uploader.ts` | `makeHttpUploader()` — multipart POST to the trace ingest Worker. |
| `providers/local.ts` | `openLocalBrowser()` — wraps the `agent-browser` CLI. |
| `SPEC.md` | Bundle layout, URL routes, JSON shapes, versioning. |
| `SECURITY.md` | Deploy posture, signing, upload path, guardrail checks. |

## Phase 0 decisions (frozen)

| Decision | Value |
|---|---|
| Interface | `BrowserHandle` in `types.ts` |
| Id format | `^[0-9a-z]{12}$` |
| Bundle version | `v0` |
| Viewer URL | `https://<domain>/r/:id` and three sub-routes |
| Default domain | `unsurf.coey.dev` |
| Signing | HMAC-SHA256, 7-day default expiry |

See the matching doc for the why on each.

## Next

Phase 1 implements `record()` in `index.ts` against the frozen interface. Phases 2-5 run in parallel once 0 ships.
