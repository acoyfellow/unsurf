# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
