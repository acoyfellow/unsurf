# skills/record

Record any agent browser run. Returns a canonical URL: video, step trace, receipt.

**Status:** 0.0.1 — Phase 0 frozen. Runtime not yet implemented.

## Files in this folder

| File | Purpose |
|---|---|
| `index.ts` | Public entry. Exports types + frozen constants. |
| `types.ts` | Type surface. `BrowserHandle`, `RecordOptions`, bundle shapes. |
| `SPEC.md` | Bundle layout, URL routes, JSON shapes, versioning. |
| `SECURITY.md` | Two-Worker split, signing, upload path, guardrail checks. |
| `providers/` | Browser providers (local, filepath, browserRendering). Phase 3-5. |

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
