# trace bundle spec v0

Frozen shape for the artifact bundle produced by the `record` skill. Any tool that reads a trace URL reads this shape.

## Bundle layout

Each run produces four objects keyed by a short canonical id (12 chars, base36):

```
r2://<bucket>/<id>.webm              # Video (optional)
r2://<bucket>/<id>/trace.json        # Step timeline
r2://<bucket>/<id>/result.json       # Receipt
r2://<bucket>/<id>/meta.json         # Task + provider metadata
```

Immutable. No updates, no deletes except via retention policy.

## URL shape

One canonical viewer domain. Every artifact is reachable from it.

| Route | Content-Type | Cached |
|---|---|---|
| `/r/:id` | `text/html` | edge, 1h |
| `/r/:id.json` | `application/json` | edge, 1d |
| `/r/:id/video.webm` | `video/webm` | signed, 7d expiry |
| `/r/:id/trace` | `application/json` | edge, 1d |
| `/r/:id/meta` | `application/json` | edge, 1d |

The `:id` is the same across all routes. The HTML route renders the player with the other three inlined or fetched client-side.

## JSON shapes

See `types.ts` for authoritative definitions. Summary:

### `trace.json`

```jsonc
{
  "version": "v0",
  "id": "abc123",
  "startedAt": "2026-04-20T18:32:00.000Z",
  "finishedAt": "2026-04-20T18:32:47.000Z",
  "steps": [
    { "t": 0,     "op": "goto",  "args": { "url": "https://localhost:7445" }, "status": "ok", "durationMs": 850 },
    { "t": 900,   "op": "fill",  "args": { "selector": "textarea", "value": "..." }, "status": "ok", "durationMs": 40 },
    { "t": 950,   "op": "click", "args": { "selector": "button[type=submit]" }, "status": "ok", "durationMs": 12 }
  ]
}
```

Monotonic `t`. No wall-clock per step. Duration is the method call, not the wait until effect lands.

### `result.json`

```jsonc
{
  "version": "v0",
  "id": "abc123",
  "status": "succeeded",
  "startedAt": "2026-04-20T18:32:00.000Z",
  "finishedAt": "2026-04-20T18:32:47.000Z",
  "durationMs": 47000,
  "task": "verify stratus AI sidebar happy path",
  "evidence": { /* ProofSpec EvidenceBundle, optional */ }
}
```

`status: "failed"` when the callback threw. Video is still uploaded in that case.

### `meta.json`

```jsonc
{
  "version": "v0",
  "id": "abc123",
  "task": "verify stratus AI sidebar happy path",
  "provider": "filepath",
  "harness": "pi",
  "extra": {
    "runId": "r_abc123",
    "workspaceId": "ws_xyz"
  }
}
```

Freeform `extra`. Callers stuff in whatever helps cross-system lookup.

## Id format

12 chars, base36 (`0-9a-z`). Generated client-side by the skill. Collision-resistant for the retention window; not a security primitive. Signed URLs do the auth.

Regex: `^[0-9a-z]{12}$`

## Versioning

`version: "v0"` on every JSON object. Skill and viewer both refuse to parse objects with an unknown version. When v1 lands, viewer can read both; skill writes only the current version.

## Compatibility contract

| Consumer | What it reads | Version lock |
|---|---|---|
| viewer Worker | all four objects | reads v0 only in 0.0.1 |
| lab | `result.json` | structural superset of lab result |
| gateproof | `result.json.evidence` | `EvidenceBundle` from proof-spec v0 |
| filepath | `meta.json.extra` | expects its own `runId` |

Breaking any of these bumps the file's `version`.
