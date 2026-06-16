# unsurf

```text
turn browser-agent claims into independently replayed proof
```

Unsurf takes a vague browser symptom, discovers a reproducible path in a real browser, and confirms the path against broken and fixed targets.

## Investigate a bug

```bash
unsurf doctor

unsurf investigate \
  --symptom "The response looked complete, then continued" \
  --broken "$BASELINE_URL" \
  --fixed "$CANDIDATE_URL"
```

A successful run produces:

```text
✓ PASS — fix confirmed
  candidates: 2/4
  broken:     3/3 reproduced
  fixed:      3/3 clean

  Repro:  .unsurf/runs/<id>/repro.json
  Report: .unsurf/runs/<id>/report.md
  Result: .unsurf/runs/<id>/result.json
```

Replay the same portable contract anywhere:

```bash
unsurf replay .unsurf/runs/<id>/repro.json \
  --target https://candidate-preview.example.com \
  --runs 3
```

## Why Unsurf

```text
cmux lets an agent use a browser.
Unsurf lets an engineer trust what the browser agent claims happened.
```

Unsurf owns:

- parallel causal investigation;
- candidate promotion;
- deterministic fresh replay;
- broken/fixed comparison;
- portable repro contracts;
- evidence receipts and reviewer reports.

Browser providers own interaction. Unsurf does not reimplement their browser UI.

## Providers

### cmux browser

The canonical local provider uses cmux's in-app browser and the authenticated browser profile you already trust. It supports navigation, interaction, snapshots, screenshots, and human takeover.

cmux's current WKWebView provider does not expose CDP traces, network capture, or screencast recording. Its Default profile is shared across surfaces. Unsurf reports those limitations explicitly.

### Browser Run

Use Cloudflare Browser Run for hosted, public, scalable, isolated execution and native rrweb session recordings.

```ts
import { openBrowserRunBrowser } from "unsurf/skills/record";
```

### Attached Chrome

The legacy attached-Chrome provider remains available for local playable video recording where that evidence is useful.

## Evidence model

Reproducibility is mandatory. Video is optional evidence.

Depending on provider capabilities, a run may contain:

- portable replay steps and assertions;
- action timelines;
- snapshots;
- screenshots;
- video;
- rrweb session replay;
- traces or network logs.

A provider never claims artifacts it cannot capture.

## Library API

```ts
import { investigate, replayRepro } from "unsurf/investigate";

const { receipt, outDir } = await investigate({
  symptom: "Checkout returned to processing",
  brokenUrl: baseline,
  fixedUrl: candidate,
  selector: '[data-testid="checkout"]',
  attribute: "data-status",
  failureValue: "processing",
  successValue: "complete",
});
```

## Other surfaces

Unsurf also retains its earlier useful primitives:

- `unsurf-local-mcp` for nearby agents driving attached Chrome/CDP sessions;
- `record` for capability-aware trace bundles;
- `observeVideo` and `loop` for video-capable providers;
- `scout`, `worker`, and `heal` for typed reusable HTTP seams;
- hosted MCP at `https://unsurf-api.coey.dev/mcp`.

## Documentation

- Website: https://unsurf.coey.dev
- Investigate: `docs/src/content/docs/guides/investigate.mdx`
- Product direction: `docs/NORTHSTAR.md`
- Exp-014 proof: `experiments/exp-014-can-parallel-browser-investigators-discover-and-confirm-a-repro/RESULT.md`

## License

MIT
