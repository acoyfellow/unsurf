# unsurf

```text
let agents use the browser you already trust
```

Unsurf is an authenticated browser runtime for agents.

It lets an agent:

- act inside a real logged-in browser session
- record the run as video + trace + receipt
- watch its own recording and refine until a North Star is met
- expose that browser to nearby agents through local MCP
- surface typed APIs from websites when the underlying HTTP seam is worth reusing

The browser is the auth. The recording is the proof. The API is the seam.

---

## Core surfaces

| Surface | Purpose |
|---|---|
| `unsurf-local-mcp` | Let nearby agents discover and drive your live browser |
| Browser Run provider | Run hosted BrowserHandle flows inside Cloudflare Workers |
| `record` | Capture browser work as video + trace |
| `observeVideo` | Ask questions about a recording |
| `loop` | Record → observe → refine |
| `scout` | Capture useful API traffic from a website |
| `worker` | Replay captured APIs directly |
| `heal` | Repair broken replay paths |
| Directory | Share discovered seams |

## Use the browser you already authenticated

Start from a real Chrome For Testing profile, sign in once, and reuse it:

```bash
agent-browser --headed --profile ~/.cmux-browser open https://example.com
```

Then attach Unsurf to that browser instead of launching a fresh one:

```bash
bunx unsurf record ./demo.ts --task "authenticated proof" --cdp-port 9222
```

```ts
import { recordAttachedLocal } from "unsurf/skills/record";

const result = await recordAttachedLocal({
	connect: 9222,
	task: "record the browser session I already trust",
	run: async (browser) => {
		await browser.goto("https://example.com/dashboard");
		await browser.wait(4000);
	},
});
```

## Give nearby agents that browser

```json
{
  "mcpServers": {
    "unsurf-local": { "command": "unsurf-local-mcp" }
  }
}
```

Local tools:

- `unsurf_local_sessions` — list attachable Chrome/CDP tabs
- `unsurf_local_execute` — run small browser action plans, optionally through Unsurf recording

Use this when another local agent should drive the session you already authenticated, not a blank headless browser.

## Run hosted browser flows on Cloudflare Browser Run

```ts
import { openBrowserRunBrowser } from "unsurf/skills/record";

export default {
	async fetch(_request, env) {
		const browser = await openBrowserRunBrowser({
			binding: env.BROWSER,
			viewport: { width: 430, height: 760 },
		});
		try {
			await browser.goto("https://example.com");
			const snapshot = await browser.snapshot();
			return Response.json(snapshot);
		} finally {
			await browser.close();
		}
	},
};
```

The Browser Run provider is for hosted Worker-side action flows and Cloudflare-native session recordings:

```ts
import { recordBrowserRunSession } from "unsurf/skills/record";

const recording = await recordBrowserRunSession({
	binding: env.BROWSER,
	run: async (browser) => {
		await browser.goto("https://httpbin.org/forms/post");
		await browser.fill('input[name="custname"]', "unsurf");
	},
});
// recording.sessionId → replay in Browser Run logs / recording API
```

Browser Run session recordings are rrweb replay events, not MP4 files. Local attached Chrome remains the authful, playable-video path.

## Record and inspect browser work

```ts
import { recordLocal } from "unsurf/skills/record";

const result = await recordLocal({
	task: "verify the happy path",
	run: async (browser) => {
		await browser.goto("https://example.com");
		await browser.wait(1000);
	},
});
```

Each run can produce:

- a browser video
- a step trace
- a structured result bundle
- a grant-gated viewer URL

## Close the loop

```ts
import { loop } from "unsurf/skills/loop";

const result = await loop({
	spec: "open coey.dev and visit the first project",
	northStar: "Did the user land on a project page?",
	maxIterations: 3,
});
```

`loop()` records a run, asks `observeVideo()` whether the North Star was met, refines, and tries again when needed.

## Reuse a website's hidden API when it helps

Unsurf still turns useful website behavior into typed, replayable seams:

```ts
import { scout, worker, heal } from "unsurf";

const found = await scout({
	url: "https://example.com",
	task: "find the search API",
});

const data = await worker({ pathId: found.pathId });
const fixed = await heal({ pathId: found.pathId, error: "endpoint drifted" });
```

Use the API path when repeated HTTP replay is better than repeatedly driving the UI.

## Hosted MCP

The hosted MCP server exposes scout/search/plan surfaces:

```json
{
  "mcpServers": {
    "unsurf": { "url": "https://unsurf-api.coey.dev/mcp" }
  }
}
```

Use hosted MCP for remote Unsurf capabilities. Use local MCP for your live browser.

## Auth

The agent runs inside the browser session you already authenticated:

- cookies
- localStorage
- credentialed fetches
- WebAuthn-compatible real Chrome flows

No copied cookie bundle. No new credential vault. No delegation layer standing between the agent and the browser you can inspect.

## Stack

Cloudflare-backed services power the hosted layer:

- Workers
- Workers AI
- Browser Rendering for hosted scouting
- D1 + R2 for stored specs, runs, and traces
- Streamable HTTP MCP endpoint

Local runtime pieces remain swappable behind Unsurf's `BrowserHandle`; today the local provider is powered by `agent-browser`.

## Roadmap

- polish pause / steer / resume for live human intervention
- keep tightening local browser MCP into the default cross-agent browser control plane
- extend Browser Run from hosted BrowserHandle flows toward optional cloud proof capture where it fits

## Docs

- Website: https://unsurf.coey.dev
- Record: `docs/src/content/docs/guides/record.mdx`
- MCP: `docs/src/content/docs/guides/mcp.mdx`
- Product direction: `docs/NORTHSTAR.md`

## License

MIT
