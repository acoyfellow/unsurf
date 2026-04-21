# trace skill — security posture

Written against the 2026-04-15 rules: no public Workers with bindings, Access before deploy, secret-before-code.

## Two-Worker split

| Worker | Domain | Public? | Bindings | Purpose |
|---|---|---|---|---|
| **viewer** | `unsurf.coey.dev/r/*` | yes | **none** | Serves HTML player, fetches signed R2 URLs |
| **ingest** | `ingest-trace.unsurf.coey.dev` | no (Access) | R2 write, signing key | Receives bundles from callers |

The viewer is public by design **because it has nothing dangerous on it**. It cannot write to R2, cannot read secrets, cannot call AI, cannot touch D1. It is a signed-URL proxy and a static HTML template. If it gets pwned, the blast radius is "someone served weird HTML at our domain" — no data exfil.

The ingest is Access-gated. Every upload carries a Cloudflare Access JWT. No API keys, no bearer tokens, no secrets in headers.

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

## Upload path

```
caller → POST ingest.unsurf.coey.dev/upload (Access JWT)
         multipart: video, trace, result, meta
      → ingest Worker validates JWT
      → ingest Worker puts four R2 objects
      → ingest Worker returns { id, viewerUrl }
```

Ingest enforces:

| Check | Failure mode |
|---|---|
| Access JWT valid, not expired | 401 |
| Email in JWT matches Access policy | 403 |
| Total bundle size < 500 MB | 413 |
| `trace.json`, `meta.json`, `result.json` parse as v0 | 422 |
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
