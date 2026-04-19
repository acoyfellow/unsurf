#!/usr/bin/env bun
/**
 * Loads the unpacked extension into Playwright's Chromium and verifies:
 *   1. Service worker registers cleanly
 *   2. Content script runs on a test page
 *   3. Polyfill + injected.js reach the main world (navigator.modelContext exists)
 *   4. A synthetic catalog postMessage actually registers a tool
 *
 * Not a real unit test — a smoke test to run before committing changes to the extension.
 *   bun run examples/webmcp-extension/_verify.ts
 */

import { chromium } from "playwright";
import { resolve } from "node:path";
import { createServer } from "node:http";

const EXT = resolve(import.meta.dir);
const PORT = 8898;

async function serveTestPage() {
	const server = createServer((req, res) => {
		if (req.url === "/") {
			res.writeHead(200, { "content-type": "text/html" });
			return res.end(`<!doctype html>
<html><head><title>unsurf verify</title></head>
<body>
	<h1>unsurf verification page</h1>
	<form>
		<label>Name <input name="name" /></label>
		<button type="button" id="greet">Greet</button>
	</form>
	<pre id="log"></pre>
</body></html>`);
		}
		res.writeHead(404); res.end();
	});
	await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));
	return server;
}

async function main() {
	const server = await serveTestPage();
	console.log(`test page: http://127.0.0.1:${PORT}/`);
	const ctx = await chromium.launchPersistentContext("", {
		headless: false,
		args: [
			`--disable-extensions-except=${EXT}`,
			`--load-extension=${EXT}`,
			"--no-default-browser-check",
			"--no-first-run",
		],
	});
	// Service worker should register within a second or two
	await new Promise(r => setTimeout(r, 2000));
	const sws = ctx.serviceWorkers();
	console.log(`service workers: ${sws.length}`, sws.map(s => s.url()));

	const page = await ctx.newPage();
	page.on("console", (msg) => {
		if (msg.type() === "log" || msg.type() === "warn" || msg.type() === "error") {
			console.log(`  PAGE ${msg.type()}: ${msg.text().slice(0, 200)}`);
		}
	});
	page.on("pageerror", (e) => console.log("  PAGE-ERR:", e.message));

	await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle", timeout: 15000 });
	// Give content script + injections time
	await new Promise(r => setTimeout(r, 1500));

	// Probe main-world state
	const probe = await page.evaluate(() => {
		return {
			has_modelContext: typeof (navigator as any).modelContext !== "undefined",
			has_registerTool: typeof (navigator as any).modelContext?.registerTool === "function",
			unsurf_flag: !!(window as any).__unsurf_registered__,
			mcp_b_exposed: typeof (window as any).__mcp_b !== "undefined" || typeof (window as any).mcpB !== "undefined",
		};
	});
	console.log(`\nmain-world probe:`, JSON.stringify(probe, null, 2));

	// Send a synthetic catalog and see if registerTool gets called
	const registered = await page.evaluate(async () => {
		// Listen for tool registration
		let caught: any = null;
		const orig = (navigator as any).modelContext?.registerTool;
		if (orig) {
			(navigator as any).modelContext.registerTool = (spec: any) => {
				caught = spec;
				return orig.call((navigator as any).modelContext, spec);
			};
		}
		window.postMessage({
			type: "unsurf:register-catalog",
			catalog: {
				version: "v0",
				url: location.href,
				tools: [
					{
						name: "greet_user",
						description: "Click the Greet button and read the response",
						inputSchema: { type: "object", properties: {} },
						dsl: [{ op: "click", target: { role: "button", name: "Greet" } }],
						risk: "medium",
					},
				],
			},
		}, "*");
		// Wait a moment for the injected handler to run
		await new Promise(r => setTimeout(r, 500));
		return caught ? { registered: true, tool_name: caught.name } : { registered: false };
	});
	console.log(`\nregistration probe:`, JSON.stringify(registered, null, 2));

	const pass =
		probe.has_modelContext &&
		probe.has_registerTool &&
		probe.unsurf_flag &&
		registered.registered;

	console.log(`\n${pass ? "✓ PASS" : "✗ FAIL"} — extension loads and registers tools`);

	await ctx.close();
	server.close();
	process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
