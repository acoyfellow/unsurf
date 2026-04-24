# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.4.0] - 2026-04-24

### Changed (breaking default, API-compatible)
- **Every new trace upload is grant-gated.** `visibility` in the upload's
  `meta.json` now defaults to `"private"` (was `"public"`). Bare
  `/r/<id>` requests for new traces return 404. The only shareable link
  is the signed `viewerUrl` returned in the upload response.
- Explicit `visibility: "public"` is now a **long-lived (365-day) grant**,
  not a bare URL. Still revocable via `unsurf trace-revoke`. Still
  auditable via `grantGeneration`. There is no way, via the public API,
  to produce a new bare-URL trace.
- **Grandfathered bundles** (uploaded before 0.4.0, with no `visibility`
  field in stored meta) continue to serve bare — so existing links,
  including the README dogfood URL, keep working.
- `POST /admin/traces/:id/revoke` now accepts both `"public"` and
  `"private"` bundles (previously private-only).

### CLI
- `unsurf record ... --public` — opts into the long-lived 365-day grant.
  Default is private/7-day.
- `--private` flag kept as a no-op alias for transition; existing
  scripts that pass it keep working but no longer change behavior.
- `unsurf loop ... --public` — same, for per-iteration recordings.

### Security rationale
The bare-URL default was a footgun: 12-char base36 isn't guessable
(≈4.7×10¹⁸) but pasting a trace URL into Slack, a PR description, or
a log file made it world-readable forever. Grant-gating every new
upload eliminates the class of leakage at the source. Existing links
are preserved via the grandfathering rule.

### Verified live in CI (`scripts/verify-post-deploy.ts`)
- Default upload (no explicit visibility) stored as `"private"` with
  signed `viewerUrl`.
- Bare `/r/<id>` on a fresh upload → 404.
- Explicit public upload → still grant-gated; bare → 404; grant → 200.
- Pre-migration bundle (`nb9uurla35eg`) → still renders bare.

## [0.3.0] - 2026-04-24

### Added
- `skills/record` — record any agent browser run; returns `{ url, videoUrl, viewerUrl }` pointing at `trace.coey.dev/r/:id`. Produces a real WebM (not rrweb), a step trace, and a JSON receipt.
- `skills/observe-video` — feed a recording + a natural-language question, get back `{ answer, confidence, evidenceFrames }`. Defaults to Workers AI (`@cf/google/gemma-3-12b-it` vision + `@cf/moonshotai/kimi-k2.6` synthesis) with pluggable backends.
- `skills/loop` — orchestrator that closes the record → observe → refine cycle until a North Star is met. Tick-budgeted and error-budgeted so it can't hang.
- **Private traces** — opt-in `visibility: "private"` returns a signed viewer grant (`?vt=<exp>.<gen>.<sig>`), reusing the existing `TRACE_SIGNING_KEY`. Default TTL 7 days.
- **Grant revocation** — `unsurf trace-revoke <id>` bumps a per-trace `grantGeneration` counter in meta.json; every outstanding grant stops working without touching other traces.
- **OG images + embed mode** — every trace has `/r/:id/og.svg` (light card with status pill) and `/r/:id?embed=1` (chrome-less viewer for iframes).
- **New CLI commands**: `unsurf record ... --private`, `unsurf loop <goal|spec.json> --north-star "..."`, `unsurf trace-token mint|revoke`, `unsurf trace-revoke <id>`.
- **Trace viewer redesign** — light clinical palette (Stripe-adjacent), click-to-seek steps with timeupdate auto-highlight, copy-link button, status pill, private badge.
- **Ingest hardening** — per-owner token KV (`TRACE_TOKENS`), Workers Rate Limit binding (120/min/token), R2 lifecycle (90-day TTL on `trace/*`, IA transition after 30 days). Legacy single-token auth preserved as a fallback.
- **Post-deploy CI verification** — `scripts/verify-post-deploy.ts` runs against the live worker after every deploy: 6-step auth matrix, 5-step privacy matrix, Workers AI observeVideo E2E.
- **Manual workflows**: `Upload demo bundle` and `Loop demo` on the Actions tab — produce a live trace URL from a click.

### Changed
- Kimi K2.6 synthesis now uses Workers AI's native `response_format: { type: "json_schema" }` instead of prompt-engineering + regex extraction. Model-agnostic: the runtime enforces the shape.
- Recorder temp bundle now has a canonical layout and uses a 12-char base36 id with a frozen regex.

### Fixed
- Kimi reasoning-leak into `message.content` (the synthesis backend now reads `content` only; `reasoning_content` is explicitly ignored to keep chain-of-thought out of callers' answer strings).

## [0.2.0] - 2026-02-16

### Added
- API Directory with 17+ community-discovered APIs
- `force` option to skip gallery cache during scout
- `headers` support in Worker for authenticated endpoints
- Validation safeguards for directory publish
- DELETE endpoint for directory cleanup

### Changed
- Simplified directory UI to minimal table design
- OpenAPI paths now use relative URLs instead of full URLs

### Fixed
- `publish` flag now properly passed through scout HTTP handler
- ValidationError now propagates instead of being silently caught

## [0.1.0] - 2024-02-10

### Added
- Initial release
- Scout tool: browser-based API discovery
- Worker tool: replay captured endpoints
- Heal tool: re-scout broken paths
- MCP server support
- Gallery for caching discovered specs
- Cloudflare Worker deployment
- Effect-based architecture
- OpenAPI 3.1 spec generation
