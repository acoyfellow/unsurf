/**
 * Smoke demo for `unsurf record`.
 *
 * Run:
 *   export TRACE_INGEST_TOKEN=...            # from your Worker secret
 *   export TRACE_INGEST_ENDPOINT=https://trace.coey.dev   # optional (default)
 *   bunx unsurf record ./examples/record-demo.ts --task "record demo"
 *
 * Requires `agent-browser` on PATH: `npm i -g agent-browser && agent-browser install`.
 */

import type { BrowserHandle } from "../src/skills/record/types.js";

export default async function run(browser: BrowserHandle): Promise<{ title: string }> {
	await browser.goto("https://example.com");
	await browser.wait(500);
	const snap = (await browser.snapshot()) as { title?: string } | string;
	const title = typeof snap === "object" && snap?.title ? snap.title : "example";
	return { title };
}
