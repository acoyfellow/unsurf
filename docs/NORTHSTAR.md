# unsurf North Star

> _"Humans and agents hand unsurf a goal; unsurf drives a real browser, produces a narrated mp4 + trace bundle, and — for agents — closes the loop by watching its own video and refining the spec until the North Star is met."_

## The USP is the mp4

Videos are the product. Not screenshots, not rrweb JSON, not DOM snapshots. **A shareable `.mp4` of the agent doing the thing.** This is the demo, the docs, the dogfood, the tweet.

Everything else (trace.json, result.json, meta.json, steps list) is supporting evidence around the video.

## The two canonical invocations

```ts
// Human path (the main USP)
const { videoUrl, traceUrl } = await unsurf.record({
  url: "coey.dev",
  steps: "click Projects, scroll, pick the one you resonate with",
});

// Agent path (the compounding loop)
await unsurf.loop({
  spec: "log into the cmux dashboard with yubikey",
  northStar: "reach the authenticated dashboard URL",
  maxIterations: 5,
});
```

## What runs where — design choices

| Concern | Choice | Rationale |
|---|---|---|
| Primary execution | Local (real Chrome via agent-browser) | Best video fidelity, already works |
| Cloud execution | Future optional provider | Nice-to-have, not a replacement |
| Vision backend | Workers AI (Llama 3.2 vision) | Free-tier, CF-native, no vendor keys |
| Refiner LLM | Kimi K2.6 via Workers AI | Top-tier reasoning, on-platform |
| Storage | R2 (`trace.coey.dev`) | Already wired, signed URL viewer |
| Auth (ingest) | Per-token KV table | Replaces single shared token |
| Rate limiting | Workers Rate Limit binding | Native, per-token keyed |

## Non-goals (explicit)

- ❌ Using CF Browser Run for recording. Its session recording is rrweb DOM events, not mp4. We dogfood real Chrome.
- ❌ Eliminating the local provider. It is the primary path.
- ❌ Treating the cloud provider as a priority. It's Phase 4, maybe never.

## Phases (order may change; all ship independently useful units)

### Phase 0 — prove form-fill E2E ✅
Before building anything new, verify the current `record()` skill produces a clean mp4 of a form-fill tour. If it hangs or misbehaves, fix the foundation first. Win: `bun examples/form-fill-demo.ts` writes an mp4 to `trace.coey.dev/r/<id>`.

### Phase 1 — harden ingest ✅
- Per-token KV table (`tokens[hash] = { owner, scope, quota, revoked }`)
- Workers Rate Limit binding on `/upload`
- R2 lifecycle: 90-day TTL on trace bundles, IA tier after 30 days
- Back-compat: keep legacy `TRACE_INGEST_TOKEN` working until migration is done

### Phase 2 — `observeVideo()` skill ✅
- `src/skills/observe-video/` with same shape as `record/`
- Keyframe extraction via ffmpeg scene-change filter (drop near-duplicates)
- Vision backend interface; default impl = Workers AI Llama 3.2 vision
- API: `await observeVideo(mp4Path, "did X happen?") → { answer, confidence, evidenceFrames }`
- Win: feed a form-fill mp4 in, correctly answer "was the form submitted?"

### Phase 3 — `loop()` skill ✅
- `src/skills/loop/` — orchestrator, not a provider
- Tick-gated control loop (pulse pattern, no hanging on silent failures)
- Refiner LLM: Kimi K2.6 on Workers AI, given `{ currentSpec, observation, northStar }`
- Emits one trace bundle per iteration + a stitched "loop bundle"
- Win: give it a 2-iteration North Star, confirm it refines and stops

### Phase 4 — cloud execution (optional, deferred)
- `src/skills/record/providers/browser-run.ts` using `@cloudflare/puppeteer` + `Page.startScreencast` + wasm-ffmpeg stitching
- `POST /record`, `POST /observe`, `POST /loop` endpoints
- Durable Object per scope for natural concurrency isolation
- MCP surface: 2 tools only (`unsurf_search` + `unsurf_execute`)

## Working agreement

- The agent (me) proves each phase E2E before pinging Jordan.
- No "looks like it should work" — run it, watch the mp4, confirm the asserted behavior.
- Foundation must hold before building on top.

## Design decisions that firmed up along the way

- **Workers AI `response_format: json_schema`** is the shape guarantee.
  No userland retry loop, no regex extraction, no model-specific branching.
  The inference runtime enforces the JSON schema at decode time.
- **Privacy by grant, not by auth.** Private traces use short-lived
  HMAC-signed viewer grants (`?vt=<exp>.<gen>.<sig>`) rather than
  per-user accounts. Revocation is a `grantGeneration` bump in meta.json
  — no KV namespace for revoked tokens, no key rotation.
- **Video is the product.** Every UI, doc, and demo leads with the mp4.
  CF Browser Run's rrweb recording is explicitly rejected as the main path.
- **Record uploads from the laptop.** The cloud-side provider (Phase 4)
  remains a *nice-to-have* slot, not a replacement. Real-Chrome
  fidelity matters more than horizontal scale for the USP.
