# Result: Pass (native Browser Run recording)

`recordBrowserRunSession(...)` now ships as the native cloud-recording API for Browser Run sessions.

## Live proof

Endpoint:

- `https://unsurf-browser-run-proof.coy.workers.dev/session-recording-proof`

Response:

```json
{
  "ok": true,
  "format": "rrweb",
  "sessionId": "607df7b7-6800-4aa9-98f1-f74670ed3478",
  "returned": {
    "url": "https://httpbin.org/forms/post"
  },
  "durationMs": 5421
}
```

The proof Worker imports `recordBrowserRunSession(...)` from product source, enables `recording: true` on Browser Run, executes a real form interaction, and closes the session so Cloudflare can finalize its recording.

## Product boundary

- Browser Run cloud recording: native rrweb replay session, addressed by `sessionId` and available through Browser Run logs/API.
- Local attached recording: playable WebM/MP4 path used for marketing and human sharing.

These are both recordings, but they are intentionally different artifact types. No documentation should claim Browser Run returns an MP4.

## Retrieval note

The existing personal deploy token can deploy and execute Browser Run bindings but lacks permission to read the recording REST endpoint directly (`Authentication error`). Viewing/retrieving the finalized rrweb recording requires a token with the appropriate Browser Run API permission or the Cloudflare dashboard.
