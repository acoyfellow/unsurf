# skills/record

```
agent runs → video + receipt → shareable URL
```

Record any agent browser run. Returns a canonical URL: video, step trace, receipt.

**Status:** 0.4 — local provider + HTTP ingest + viewer Worker live,
**every new trace is grant-gated by default** (see Privacy below).
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
export TRACE_INGEST_TOKEN=...       # see "Getting a token" below
bunx unsurf record ./examples/record-demo.ts --task "demo"
bunx unsurf record ./examples/record-demo.ts --task "demo" --public   # 365d grant
```

**Requirements:** `agent-browser` on PATH, `TRACE_INGEST_TOKEN` env.

## Private by default

As of 0.4.0 every new upload is grant-gated. The upload response's
`viewerUrl` is the canonical shareable link — the bare `/r/<id>`
returns 404 for new traces.

```ts
const result = await recordLocal({
  task: "log into cmux",
  run: async (browser) => { /* ... */ },
});
console.log(result.viewerUrl);
// → https://trace.coey.dev/r/<id>?vt=<exp>.<generation>.<signature>
```

For a long-lived shareable (365-day grant, still revocable, still
grant-gated), pass `visibility: "public"`:

```ts
const result = await recordLocal({
  task: "public demo",
  visibility: "public",
  run: async (browser) => { /* ... */ },
});
```

- Default TTL: **7 days** for private, **365 days** for public. After that the grant rejects with 404.
- Share the `viewerUrl`; the bare `/r/<id>` returns 404 for any post-0.4.0 trace.
- Tampered grants, expired grants, and wrong-generation grants all 404.
- **Revoke on demand** via `unsurf trace-revoke <id>` — bumps the meta's
  `grantGeneration` counter and returns a fresh grant. Every prior grant
  immediately stops working. Works for public and private alike.
- **Grandfathered bundles** (pre-0.4.0, no `visibility` field in stored
  meta) continue to serve bare so existing links don't break.

## Getting a token

There are two kinds of ingest tokens. The worker accepts both, so downstream
code doesn't care which one you hand it.

### 1. Per-owner tokens (what you should use)

Stored in the `TRACE_TOKENS` KV namespace, scoped by owner name, revocable.
Rate-limited per token. Mint one with the CLI:

```bash
export TRACE_INGEST_TOKEN=<root-token>   # the admin token; see below
unsurf trace-token mint --owner your-name
# { "token": "abc…", "owner": "your-name", "createdAt": "…" }
```

Copy the `token` value into the env var you actually record with (overwrites
the root token). Revoke with `unsurf trace-token revoke <token>`.

### 2. The root/legacy token (admin only)

One shared bearer string that authenticates the `/admin/tokens` endpoints.
Matches the `TRACE_INGEST_TOKEN` value the worker was deployed with.

- **Source of truth:** the `TRACE_INGEST_TOKEN` GitHub secret on the
  `acoyfellow/unsurf` repo.
- **Also accepted** directly on `/upload` so bootstraps and the
  minting CLI work before any KV entries exist.
- **Do not hand this out** to end users. Mint them a per-owner token instead.

If you're wiring unsurf into a fresh deploy, generate a new root token
with `openssl rand -hex 32` and set it as both the `TRACE_INGEST_TOKEN`
env at deploy time and the Worker secret of the same name.

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
