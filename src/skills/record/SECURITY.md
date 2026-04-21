# trace skill — security posture

Written against the 2026-04-15 rules: no public Workers with bindings, Access before deploy, secret-before-code.

## v0.0.1 — single Worker, bearer-token ingest

Shipped at `trace.coey.dev`. Serves both the viewer (`/r/:id*`) and ingest
(`POST /upload`) from one Worker. Single caller = Jordan's laptop via
`unsurf record` CLI.

| Surface | Auth | Bindings used |
|---|---|---|
| `GET /r/:id*` public viewer | none (signed URLs for video) | `STORAGE` (read only) |
| `POST /upload` ingest | `Authorization: Bearer $TRACE_INGEST_TOKEN` | `STORAGE` (read/write), `TRACE_SIGNING_KEY` |

This deliberately violates the "public Worker has zero bindings" rule **for
v0.0.1 only**. The deviation is bounded:

- `STORAGE` is already shared with the main `unsurf` worker
- The signing key is used only inside the Worker, never emitted
- The ingest token check is constant-prefix, single-tenant

## v0.1 — two-Worker split (planned)

When there is >1 upload client, split into:

| Worker | Domain | Public? | Bindings | Purpose |
|---|---|---|---|---|
| **viewer** | `trace.coey.dev/r/*` | yes | **none** | Static HTML + service binding to ingest for signed URLs |
| **ingest** | `trace-ingest.coey.dev` | Access-gated | R2 write, signing key | Receives bundles, signs playback URLs |

At that point the viewer loses all bindings and the ingest gains Cloudflare
Access. The JSON shape and URL routes stay the same across v0.0.1 → v0.1.

## Signing scheme

Playback URLs are signed with HMAC-SHA256:

```
GET /r/:id/video.webm?exp=<unix>&sig=<hex>
sig = HMAC_SHA256(TRACE_SIGNING_KEY, "<id>|<exp>")
```

- `exp` = unix seconds. Skill defaults to 7-day expiry.
- `TRACE_SIGNING_KEY` = 32-byte random, stored in Cloudflare Secret Store.
- Key lives **on the ingest Worker only**. Viewer gets signed URLs at render time via internal service binding, never generates signatures itself.

Rotation: generate a new key, leave the old one as `TRACE_SIGNING_KEY_PREV` for one retention window, then delete. Signer uses new, verifier accepts either.

## Upload path (v0.0.1)

```
caller → POST trace.coey.dev/upload (Bearer token)
         multipart: id, video?, trace, result, meta
      → Worker validates bearer token
      → Worker validates bundle shape
      → Worker puts four R2 objects under trace/<id>*
      → Worker returns { id, url, resultUrl, videoUrl }
```

Ingest enforces:

| Check | Failure mode |
|---|---|
| `Authorization: Bearer <TRACE_INGEST_TOKEN>` matches | 401 |
| Total bundle size < 500 MB (Content-Length) | 413 |
| `content-type` starts with `multipart/form-data` | 415 |
| `trace.json`, `meta.json`, `result.json` parse as v0 with matching id | 422 |
| Id regex `^[0-9a-z]{12}$` | 422 |
| Id does not already exist | 409 |

No user input reaches R2 unvalidated.

## Sandbox-direct upload (filepath provider)

Callers inside the filepath sandbox bypass the HTTP ingest. They write to R2 via a service binding from the sandbox Worker. Access check is implicit — getting into the sandbox already required filepath auth.

The sandbox provider still calls the same `Uploader` interface; its implementation is a bindings-direct writer instead of an HTTP client. The viewer is unchanged.

## Retention

- Default: 30 days, set by R2 lifecycle rule on the bucket.
- Viewer honors `Cache-Control` and returns 410 Gone when R2 returns 404.
- No soft-delete, no recovery. Traces are disposable receipts.

## What is not protected

| Risk | Mitigation in 0.0.1 |
|---|---|
| Guessing trace ids to enumerate | 12-char base36 → 4.7e18 space. Signed URLs required for video. |
| Trace captures a secret on screen | Caller's problem. Document: don't record secret flows. Viewer has no redaction. |
| Access policy too loose | Caller's Access config. Not ours. |

## Guardrail checks (must pass before deploy)

The viewer Worker's `wrangler.toml` must have:

```
# No bindings allowed on viewer. Enforced by guardrail lint.
[[r2_buckets]]     # ← forbidden
[[d1_databases]]   # ← forbidden
[[ai]]             # ← forbidden
[[kv_namespaces]]  # ← forbidden
```

`scripts/guardrail-check.ts` greps for any of these in the viewer config and fails the deploy if present. Also verifies the ingest Worker has an Access application attached before its first deploy.
