#!/usr/bin/env bun
/**
 * exp-004: prove a page-registered WebMCP tool is callable through mcp-b's relay by an MCP client.
 *
 * AMD-002: substituting Claude Desktop with a headless MCP Client (same MCP protocol, different transport host).
 *
 * Pipeline:
 *   1. Serve page.html (with polyfill + tools + embed.js) on a local HTTP server.
 *   2. Spawn @mcp-b/webmcp-local-relay as a child process — it speaks stdio MCP on one side, hosts a WebSocket server on localhost:24306 on the other.
 *   3. Open the page in headless Chromium; the embed.js connects to the WS and registers tools with the relay.
 *   4. Connect an MCP Client to the relay via stdio.
 *   5. Call tools/list, then tools/call on get_page_title + add_numbers.
 *   6. Verify results.
 */

import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = import.meta.dir;
const OUT = join(ROOT, "out");
const PORT = 8891;
const POLYFILL_IIFE = resolve(ROOT, "node_modules/@mcp-b/webmcp-polyfill/dist/index.iife.js");
const EMBED_JS = resolve(ROOT, "node_modules/@mcp-b/webmcp-local-relay/dist/browser/embed.js");

function log(...args: any[]) { console.log("[exp-004]", ...args); }

async function serveStatic() {
	const pageHtml = await readFile(join(ROOT, "page.html"), "utf8");
	const polyfill = await readFile(POLYFILL_IIFE, "utf8");
	const embed = await readFile(EMBED_JS, "utf8");
	const widgetHtml = await readFile(resolve(ROOT, "node_modules/@mcp-b/webmcp-local-relay/dist/browser/widget.html"), "utf8").catch(() => "<!doctype html><html></html>");
	const widgetJs = await readFile(resolve(ROOT, "node_modules/@mcp-b/webmcp-local-relay/dist/browser/widget.js"), "utf8").catch(() => "");
	const server = createServer((req, res) => {
		const url = req.url ?? "/";
		if (url === "/" || url === "/page.html") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(pageHtml);
		} else if (url === "/polyfill.iife.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(polyfill);
		} else if (url === "/embed.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(embed);
		} else if (url === "/widget.html") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(widgetHtml);
		} else if (url === "/widget.js") {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.end(widgetJs);
		} else {
			res.writeHead(404); res.end("404 " + url);
		}
	});
	await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", () => r()));
	log(`static server on http://127.0.0.1:${PORT}`);
	return server;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const report: any = { stages: [], final: null };

	// 1. Static server
	const httpServer = await serveStatic();
	report.stages.push({ stage: "static_server", ok: true, port: PORT });

	// 2. Launch the relay FIRST — so the embed.js can connect immediately on page load.
	const relayBin = resolve(ROOT, "node_modules/.bin/webmcp-local-relay");
	log("starting MCP relay:", relayBin);
	const transport = new StdioClientTransport({ command: relayBin, args: [] });
	const client = new Client({ name: "exp-004-client", version: "0.0.1" }, { capabilities: {} });
	await client.connect(transport);
	// Give the WS server inside the relay a moment to bind
	await new Promise(r => setTimeout(r, 1500));
	log("relay started + MCP client connected");

	// 3. Launch headless Chromium with the page (embed.js will connect to the already-running relay)
	const browser = await chromium.launch({ headless: true });
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on("console", (msg) => {
		if (msg.type() !== "log" || msg.text().startsWith("[")) log("PAGE:", msg.type(), msg.text().slice(0, 200));
	});
	page.on("pageerror", (e) => log("PAGE-ERR:", e.message));

	await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle", timeout: 15000 });
	// Wait for the status line to change
	await page.waitForFunction(() => {
		const el = document.getElementById("status");
		return el && /tools registered/.test(el.textContent ?? "");
	}, { timeout: 10000 }).catch(() => {});
	const status = await page.locator("#status").innerText().catch(() => "?");
	log("page status:", status);
	report.stages.push({ stage: "page_loaded", ok: /tools registered/.test(status), status });

	// Let the embed.js finish connecting
	await new Promise((r) => setTimeout(r, 2000));
	let connectOk = true, toolsList: any = null, getTitleResult: any = null, addResult: any = null;
	try {
		toolsList = await client.listTools();
		log("tools/list returned", toolsList.tools.length, "tool(s):", toolsList.tools.map((t: any) => t.name));
		report.stages.push({ stage: "tools_list", ok: Array.isArray(toolsList.tools), tool_names: toolsList.tools.map((t: any) => t.name) });

		// The relay surfaces the page's tools directly at the top-level (alongside its own meta-tools).
		// tools/list returned: ["add_numbers", "get_page_title", "webmcp_call_tool", "webmcp_list_sources", ...]
		// We can call get_page_title and add_numbers directly by name.

		// Sanity check: confirm our page is connected
		let sources: any = null;
		try {
			const srcRes = await client.callTool({ name: "webmcp_list_sources", arguments: {} });
			const srcText = srcRes?.content?.[0]?.text ?? "{}";
			sources = JSON.parse(srcText);
			log("sources:", JSON.stringify(sources).slice(0, 300));
			const count = sources?.count ?? (Array.isArray(sources) ? sources.length : 0);
			report.stages.push({ stage: "webmcp_list_sources", ok: count > 0, sources });
		} catch (e) {
			report.stages.push({ stage: "webmcp_list_sources", ok: false, err: String((e as any)?.message ?? e) });
		}

		// Look for our tools in the top-level listing
		const titleTool = toolsList.tools.find((t: any) => /get_page_title/.test(t.name));
		const addTool = toolsList.tools.find((t: any) => /add_numbers/.test(t.name));
		report.stages.push({
			stage: "page_tools_discoverable",
			ok: !!titleTool && !!addTool,
			has_get_page_title: !!titleTool,
			has_add_numbers: !!addTool,
		});

		// CALL get_page_title directly
		if (titleTool) {
			try {
				getTitleResult = await client.callTool({ name: titleTool.name, arguments: {} });
				log("get_page_title =>", JSON.stringify(getTitleResult).slice(0, 400));
				const text = getTitleResult?.content?.[0]?.text ?? "";
				report.stages.push({
					stage: "call_get_page_title",
					ok: !getTitleResult.isError && /exp-004 test page/.test(text),
					returned_text: text,
				});
			} catch (e) {
				report.stages.push({ stage: "call_get_page_title", ok: false, err: String((e as any)?.message ?? e) });
			}
		} else {
			report.stages.push({ stage: "call_get_page_title", ok: false, err: "tool not listed" });
		}

		// CALL add_numbers directly
		if (addTool) {
			try {
				addResult = await client.callTool({ name: addTool.name, arguments: { a: 2, b: 3 } });
				log("add_numbers(2,3) =>", JSON.stringify(addResult).slice(0, 400));
				const text = addResult?.content?.[0]?.text ?? "";
				report.stages.push({
					stage: "call_add_numbers",
					ok: !addResult.isError && text === "5",
					returned_text: text,
				});
			} catch (e) {
				report.stages.push({ stage: "call_add_numbers", ok: false, err: String((e as any)?.message ?? e) });
			}
		} else {
			report.stages.push({ stage: "call_add_numbers", ok: false, err: "tool not listed" });
		}
	} catch (e: any) {
		log("client error:", e?.message ?? e);
		report.stages.push({ stage: "client_error", ok: false, err: String(e?.message ?? e) });
	}

	try { await client.close(); } catch {}
	await ctx.close();
	await browser.close();
	httpServer.close();

	const pass = report.stages.every((s: any) => s.ok);
	report.final = {
		pass,
		summary: {
			static_server: report.stages[0]?.ok,
			page_registered_tools: report.stages[1]?.ok,
			mcp_client_connected: connectOk,
			tools_list_returned_our_tools: report.stages.find((s: any) => s.stage === "tools_list")?.tool_names?.some((n: string) => /get_page_title/.test(n)) ?? false,
			call_get_page_title: report.stages.find((s: any) => s.stage === "call_get_page_title")?.ok,
			call_add_numbers: report.stages.find((s: any) => s.stage === "call_add_numbers")?.ok,
		},
	};
	await writeFile(`${OUT}/results.json`, JSON.stringify(report, null, 2));
	log("\n=== SUMMARY ===");
	console.log(JSON.stringify(report.final, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
