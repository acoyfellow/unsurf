import { describe, expect, it } from "vitest";
import { listLocalBrowserSessions, runLocalBrowserActions } from "../src/local-mcp.js";
import type { BrowserHandle } from "../src/skills/record/types.js";

function browserStub(overrides: Partial<BrowserHandle> = {}): BrowserHandle {
	return {
		goto: async () => {},
		click: async () => {},
		fill: async () => {},
		wait: async () => {},
		snapshot: async () => ({ title: "page" }),
		screenshot: async () => new Uint8Array([1, 2, 3]),
		startRecording: async () => {},
		stopRecording: async () => {},
		close: async () => {},
		...overrides,
	};
}

describe("listLocalBrowserSessions", () => {
	it("returns attachable page tabs and drops browser internals", async () => {
		const sessions = await listLocalBrowserSessions(
			9222,
			async () =>
				"  [t1] Dash - https://dash.cloudflare.com\n→ [t2] Chrome - chrome://version\n  [t3] Docs - https://developers.cloudflare.com",
		);
		expect(sessions).toEqual([
			{ id: "t1", title: "Dash", type: "page", url: "https://dash.cloudflare.com" },
			{ id: "t3", title: "Docs", type: "page", url: "https://developers.cloudflare.com" },
		]);
	});
});

describe("runLocalBrowserActions", () => {
	it("executes action plans in order and captures read results", async () => {
		const seen: string[] = [];
		const results = await runLocalBrowserActions(
			browserStub({
				goto: async (url) => {
					seen.push(`goto:${url}`);
				},
				wait: async (arg) => {
					seen.push(typeof arg === "number" ? `wait:${arg}` : `waitFor:${arg.selector}`);
				},
			}),
			[
				{ op: "goto", url: "https://example.com" },
				{ op: "wait", ms: 25 },
				{ op: "waitFor", selector: "main" },
				{ op: "snapshot" },
				{ op: "screenshot" },
			],
		);
		expect(seen).toEqual(["goto:https://example.com", "wait:25", "waitFor:main"]);
		expect(results).toEqual([
			{ op: "goto", ok: true },
			{ op: "wait", ok: true },
			{ op: "waitFor", ok: true },
			{ op: "snapshot", ok: true, value: { title: "page" } },
			{ op: "screenshot", ok: true, value: { byteLength: 3 } },
		]);
	});

	it("stops at the first failed browser action", async () => {
		const results = await runLocalBrowserActions(
			browserStub({
				click: async () => {
					throw new Error("missing button");
				},
			}),
			[{ op: "click", selector: "button" }, { op: "snapshot" }],
		);
		expect(results).toEqual([{ op: "click", ok: false, error: "missing button" }]);
	});
});
