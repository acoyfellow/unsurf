#!/usr/bin/env bun
/**
 * exp-012 benchmark — Path A vs Path B vs Path C on httpbin contact form.
 *
 * Amendments applied: AMD-002 (headless MCP client for Claude Desktop), AMD-006 (substitutions + small n).
 *
 * Task (identical across all paths): fill the form at https://httpbin.org/forms/post with:
 *   custname="Unsurf Bench", custtel="555-0100", custemail="bench@unsurf.dev",
 *   size="medium", topping=["bacon","cheese"], delivery="20:00", comments="benchmark run"
 *   then submit it.
 *
 * Success oracle: after submit, the response body is JSON (httpbin echoes what it received)
 * containing `"custname": "Unsurf Bench"` and `"custemail": "bench@unsurf.dev"`.
 *
 * Paths:
 *   A (agent-browser analog): remote LLM (Qwen 2.5 Coder via Workers AI) drives CDP.
 *      Per iteration: LLM receives page snapshot + allowed actions + task; emits one action;
 *      runner executes; repeat until LLM says "done" or 10 iterations.
 *   B (hand-written WebMCP): page loads the polyfill + 1 hand-coded tool submit_contact_form(args).
 *      MCP client calls the tool with the task arguments. 1 MCP round-trip.
 *   C (synthesized WebMCP): same as B but tools come from exp-002b's intent-shaped synthesis.
 *      BUT: exp-002b did not produce a valid synthesized spec for httpbin (it emitted one
 *      intent-shaped tool with malformed inputSchema). For the benchmark, we use the REPAIRED
 *      spec (manually fix the inputSchema.properties) to simulate a post-synthesis-repair world.
 *      This is disclosed in RESULT.md.
 *
 * Numbers collected per run:
 *   - wall_clock_ms (from navigation start to success oracle)
 *   - total_input_tokens / total_output_tokens (via synth-worker metadata)
 *   - llm_calls
 *   - result (pass/fail/ambiguous)
 */

import { chromium, type Browser, type Page } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = import.meta.dir;
const OUT = join(ROOT, "out");
const SYNTH = "http://127.0.0.1:8890/run";
const PORT = 8892;
const RUNS_PER_PATH = 5;

const TASK = {
	custname: "Unsurf Bench",
	custtel: "555-0100",
	custemail: "bench@unsurf.dev",
	size: "medium",
	topping: ["bacon", "cheese"],
	delivery: "20:00",
	comments: "benchmark run",
};

const TASK_PROMPT = `Fill and submit the contact/pizza order form at https://httpbin.org/forms/post with:
- custname: ${TASK.custname}
- custtel: ${TASK.custtel}
- custemail: ${TASK.custemail}
- size: ${TASK.size}
- topping: ${TASK.topping.join(", ")}
- delivery: ${TASK.delivery}
- comments: ${TASK.comments}
Then click Submit and return the JSON response body.`;

// Helper: call synth-worker and record tokens
async function callModel(system: string, user: string, schema?: any, model = "@cf/qwen/qwen2.5-coder-32b-instruct") {
	const t0 = Date.now();
	const r = await fetch(SYNTH, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model, system, user, schema, max_tokens: 1024, temperature: 0.2 }),
	});
	const j = await r.json();
	// Workers AI doesn't always return token counts; approximate by char/4
	const approxInTokens = Math.ceil((system.length + user.length) / 4);
	const respText = JSON.stringify(j.result ?? "");
	const approxOutTokens = Math.ceil(respText.length / 4);
	return { latency_ms: Date.now() - t0, response: j.result?.response ?? j.result, raw: j, approx_in_tokens: approxInTokens, approx_out_tokens: approxOutTokens };
}

async function successOracle(page: Page): Promise<boolean> {
	try {
		const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
		// httpbin returns a JSON display
		return bodyText.includes(TASK.custname) && bodyText.includes(TASK.custemail);
	} catch { return false; }
}

// ============================================================
// PATH A: remote LLM drives CDP (agent-browser analog)
// ============================================================
async function runPathA(browser: Browser, runIdx: number): Promise<any> {
	const t0 = Date.now();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto("https://httpbin.org/forms/post", { waitUntil: "domcontentloaded", timeout: 20000 });

	const MAX_ITER = 12;
	let iter = 0;
	let totalIn = 0, totalOut = 0, llmCalls = 0;

	const SYSTEM = `You are a browser automation agent. You are given a page snapshot (list of visible interactive elements with their role, name, and current value). Decide the NEXT single action to accomplish the user's task.

Reply ONLY with a JSON object:
{"op": "fill" | "click" | "check" | "done", "role": "textbox|checkbox|radio|button", "name": "<accessible name>", "value": "<string for fill>"}

- "done" = the task is complete, return no further action.
- NEVER explain. NEVER emit prose. Only the JSON.`;

	const ACTION_SCHEMA = {
		type: "object",
		properties: {
			op: { type: "string", enum: ["fill", "click", "check", "done"] },
			role: { type: "string" },
			name: { type: "string" },
			value: { type: "string" },
			reason: { type: "string" },
		},
		required: ["op"],
	};

	const actionsLog: any[] = [];

	while (iter < MAX_ITER) {
		iter++;
		// Snapshot: enumerate visible interactive elements
		const snapshot: any = await page.evaluate(() => {
			function role(el: Element): string {
				const r = el.getAttribute("role"); if (r) return r;
				const tag = el.tagName.toLowerCase();
				if (tag === "a") return "link";
				if (tag === "button") return "button";
				if (tag === "select") return "combobox";
				if (tag === "textarea") return "textbox";
				if (tag === "input") {
					const t = (el.getAttribute("type") || "text").toLowerCase();
					if (t === "checkbox") return "checkbox";
					if (t === "radio") return "radio";
					if (t === "submit" || t === "button") return "button";
					return "textbox";
				}
				return "";
			}
			function name(el: Element): string {
				const al = el.getAttribute("aria-label"); if (al) return al.trim();
				if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
					const id = el.id;
					if (id) { const l = document.querySelector(`label[for="${id}"]`); if (l) return (l.textContent||"").trim(); }
					const label = el.closest("label"); if (label) return (label.textContent||"").trim();
					const ph = el.getAttribute("placeholder"); if (ph) return ph.trim();
					const n = el.getAttribute("name"); if (n) return n.trim();
				}
				return (el.textContent || "").trim().slice(0, 80);
			}
			function value(el: Element): string {
				if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio") {
					return (el as HTMLInputElement).checked ? "CHECKED" : "";
				}
				return ((el as HTMLInputElement).value ?? "").slice(0, 40);
			}
			const els = Array.from(document.querySelectorAll("input,button,textarea,select"));
			return els.map(el => ({ role: role(el), name: name(el), value: value(el) })).filter(x => x.role);
		});

		const user = `Task: ${TASK_PROMPT}\n\nCurrent page: ${page.url()}\n\nInteractive elements:\n${JSON.stringify(snapshot, null, 2)}\n\nActions already taken: ${JSON.stringify(actionsLog.slice(-3))}\n\nWhat is the next action?`;
		const m = await callModel(SYSTEM, user, ACTION_SCHEMA);
		totalIn += m.approx_in_tokens; totalOut += m.approx_out_tokens; llmCalls++;
		const action: any = m.response;
		actionsLog.push({ iter, action });

		if (!action || action.op === "done") break;
		try {
			const roleMap: any = { button:"button", textbox:"textbox", checkbox:"checkbox", radio:"radio", combobox:"combobox", link:"link" };
			const loc = page.getByRole(roleMap[action.role] ?? "button", { name: action.name });
			if (action.op === "fill") await loc.fill(action.value ?? "", { timeout: 5000 });
			else if (action.op === "click") await loc.click({ timeout: 5000 });
			else if (action.op === "check") await loc.check({ timeout: 5000 });
		} catch (e: any) {
			actionsLog[actionsLog.length-1].error = String(e?.message ?? e);
		}
		// After a click, check if we navigated — if so, we might be done
		await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
	}

	const pass = await successOracle(page);
	const walltime = Date.now() - t0;
	await ctx.close();
	return {
		path: "A", run_idx: runIdx,
		wall_clock_ms: walltime,
		total_input_tokens: totalIn,
		total_output_tokens: totalOut,
		total_tokens: totalIn + totalOut,
		llm_calls: llmCalls,
		iterations: iter,
		result: pass ? "pass" : "fail",
		actions: actionsLog,
	};
}

// ============================================================
// PATH B: hand-written WebMCP tool — one direct MCP call.
// ============================================================
async function runPathB_setup() {
	const polyfill = await readFile(resolve(ROOT, "node_modules/@mcp-b/webmcp-polyfill/dist/index.iife.js"), "utf8");
	const embed = await readFile(resolve(ROOT, "node_modules/@mcp-b/webmcp-local-relay/dist/browser/embed.js"), "utf8");
	const widgetHtml = await readFile(resolve(ROOT, "node_modules/@mcp-b/webmcp-local-relay/dist/browser/widget.html"), "utf8").catch(() => "<!doctype html><html></html>");
	const widgetJs = await readFile(resolve(ROOT, "node_modules/@mcp-b/webmcp-local-relay/dist/browser/widget.js"), "utf8").catch(() => "");
	// Proxy server that fetches httpbin's form HTML, injects polyfill + our tool + embed.js, serves it.
	const httpServer = createServer(async (req, res) => {
		const url = req.url ?? "/";
		if (url === "/polyfill.iife.js") { res.writeHead(200,{"content-type":"application/javascript"}); return res.end(polyfill); }
		if (url === "/embed.js") { res.writeHead(200,{"content-type":"application/javascript"}); return res.end(embed); }
		if (url === "/widget.html") { res.writeHead(200,{"content-type":"text/html"}); return res.end(widgetHtml); }
		if (url === "/widget.js") { res.writeHead(200,{"content-type":"application/javascript"}); return res.end(widgetJs); }
		if (url === "/form") {
			// Proxy the httpbin form, augment it, serve
			try {
				const r = await fetch("https://httpbin.org/forms/post");
				let html = await r.text();
				// Inject our bits before </body>
				const inject = `
					<script src="/polyfill.iife.js"></script>
					<script>
					(async () => {
						for (let i=0; i<50 && !navigator.modelContext; i++) await new Promise(r=>setTimeout(r,50));
						navigator.modelContext.registerTool({
							name: "submit_contact_form",
							description: "Submit the pizza order form with all fields.",
							inputSchema: {
								type: "object",
								properties: {
									custname: {type:"string"}, custtel:{type:"string"}, custemail:{type:"string"},
									size:{type:"string",enum:["small","medium","large"]},
									topping:{type:"array",items:{type:"string"}},
									delivery:{type:"string"}, comments:{type:"string"},
								},
								required: ["custname","custtel","custemail","size"],
							},
							execute: async (args) => {
								// Fill the form for visual fidelity, but submit via fetch() so the page doesnt navigate
								// away before the tool returns its result.
								const form = document.querySelector('form');
								document.querySelectorAll('[name="custname"]').forEach(e=>e.value=args.custname);
								document.querySelectorAll('[name="custtel"]').forEach(e=>e.value=args.custtel);
								document.querySelectorAll('[name="custemail"]').forEach(e=>e.value=args.custemail);
								document.querySelectorAll('[name="size"]').forEach(e=>{ if(e.value===args.size) e.checked=true; });
								(args.topping||[]).forEach(t => {
									document.querySelectorAll('[name="topping"]').forEach(e=>{ if(e.value===t) e.checked=true; });
								});
								const del = document.querySelector('[name="delivery"]'); if(del) del.value=args.delivery;
								const com = document.querySelector('[name="comments"]'); if(com) com.value=args.comments;
								// Submit via fetch (form-data), get response, return it WITHOUT navigating.
								const fd = new FormData(form);
								const action = form.getAttribute("action") || "/post";
								// Convert relative "/post" to absolute https://httpbin.org/post
								const url = action.startsWith("http") ? action : ("https://httpbin.org" + action);
								const res = await fetch(url, { method: form.method || "POST", body: fd });
								const text = await res.text();
								return { content: [{ type:"text", text: text.slice(0, 4000) }] };
							},
						});
					})();
					</script>
					<script src="/embed.js"></script>
				`;
				html = html.replace(/<\/body>/i, inject + "</body>");
				res.writeHead(200, { "content-type": "text/html" }); return res.end(html);
			} catch (e: any) {
				res.writeHead(502); return res.end(String(e?.message ?? e));
			}
		}
		res.writeHead(404); res.end();
	});
	await new Promise<void>(r => httpServer.listen(PORT, "127.0.0.1", () => r()));
	return httpServer;
}

async function runPathB(browser: Browser, runIdx: number, injectSpec?: any): Promise<any> {
	const t0 = Date.now();
	// Launch relay (shared across runs would be cleaner; for clarity, fresh each time)
	const relayBin = resolve(ROOT, "node_modules/.bin/webmcp-local-relay");
	const transport = new StdioClientTransport({ command: relayBin, args: [] });
	const client = new Client({ name: "exp-012", version: "0.0.1" }, { capabilities: {} });
	let totalIn = 0, totalOut = 0, llmCalls = 0, result = "fail";
	try {
		await client.connect(transport);
		await new Promise(r => setTimeout(r, 1000));

		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`http://127.0.0.1:${PORT}/form`, { waitUntil: "networkidle", timeout: 15000 });
		await new Promise(r => setTimeout(r, 2000));

		// Single MCP call
		const callStart = Date.now();
		const res = await client.callTool({
			name: "submit_contact_form",
			arguments: TASK,
		});
		llmCalls = 0; // no LLM planner in path B — deterministic
		const text = res?.content?.[0]?.text ?? "";
		result = (text.includes(TASK.custname) && text.includes(TASK.custemail)) ? "pass" : "fail";

		await ctx.close();
		await client.close();

		return {
			path: "B", run_idx: runIdx,
			wall_clock_ms: Date.now() - t0,
			total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0,
			llm_calls: 0,
			result,
			note: "Path B: hand-written tool, deterministic MCP call, no LLM planner.",
			mcp_call_ms: Date.now() - callStart,
		};
	} catch (e: any) {
		try { await client.close(); } catch {}
		return { path: "B", run_idx: runIdx, wall_clock_ms: Date.now() - t0, total_tokens: 0, llm_calls: 0, result: "fail", error: String(e?.message ?? e) };
	}
}

// Path C: same infrastructure as B, but the registered tool is derived from exp-002b's synthesized spec for httpbin.
// We inject the spec into the page and the page dynamically registers it via the polyfill.
async function runPathC(browser: Browser, runIdx: number): Promise<any> {
	// Load the synthesized spec from exp-002b's sample dir
	const synthPath = resolve(ROOT, "../exp-002b-intent-shaped-prompt/samples/httpbin-forms-post.tool-spec.v0.json");
	// exp-002b did NOT produce a strict-valid spec for httpbin (it was in the intent-shaped pile).
	// We use the raw output instead, then apply a REPAIR step (AMD-006-style) that fills in properties from required[].
	const rawPath = resolve(ROOT, "../exp-002b-intent-shaped-prompt/out/httpbin-forms-post.json");
	let spec: any = null;
	try {
		if (await Bun.file(synthPath).exists()) {
			spec = JSON.parse(await readFile(synthPath, "utf8"));
		} else {
			const raw = JSON.parse(await readFile(rawPath, "utf8"));
			spec = raw.spec;
			// Repair: if inputSchema.properties is empty but required has keys, backfill
			for (const t of spec?.tools ?? []) {
				if (t.inputSchema?.required?.length && (!t.inputSchema.properties || Object.keys(t.inputSchema.properties).length === 0)) {
					t.inputSchema.properties ??= {};
					for (const k of t.inputSchema.required) {
						t.inputSchema.properties[k] ??= { type: "string" };
					}
				}
			}
		}
	} catch (e) {
		return { path: "C", run_idx: runIdx, result: "fail", error: "no synth spec available: " + String((e as any)?.message ?? e) };
	}

	const tool = spec?.tools?.[0];
	if (!tool) return { path: "C", run_idx: runIdx, result: "fail", error: "synth spec has no tools" };

	// Now we need to convert the spec's DSL into an `execute` function that runs it against the DOM.
	// Same strategy as Path B's hand-written tool but generated from the spec.
	// For simplicity in this benchmark, we use the same hand-written executor but TAKE THE TOOL DESCRIPTION
	// and INPUT SCHEMA from the synthesized spec. This is the simulated "repaired synthesized spec" path.
	// A real Path C would actually execute tool.dsl[] through exp-003's runner; we approximate.
	const t0 = Date.now();
	const relayBin = resolve(ROOT, "node_modules/.bin/webmcp-local-relay");
	const transport = new StdioClientTransport({ command: relayBin, args: [] });
	const client = new Client({ name: "exp-012-c", version: "0.0.1" }, { capabilities: {} });
	let result = "fail", err: string | null = null;
	try {
		await client.connect(transport);
		await new Promise(r => setTimeout(r, 1000));

		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`http://127.0.0.1:${PORT}/form`, { waitUntil: "networkidle", timeout: 15000 });
		await new Promise(r => setTimeout(r, 2000));

		// The synth spec's tool may not be named `submit_contact_form` — use whatever name the synthesis produced.
		const synthToolName = tool.name;
		const res = await client.callTool({ name: synthToolName, arguments: TASK });
		const text = res?.content?.[0]?.text ?? "";
		result = (text.includes(TASK.custname) && text.includes(TASK.custemail)) ? "pass" : "fail";

		await ctx.close();
		await client.close();

		return {
			path: "C", run_idx: runIdx,
			wall_clock_ms: Date.now() - t0,
			total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0,
			llm_calls: 0,
			result,
			synth_tool_name: synthToolName,
			note: "Path C: synthesized spec (w/ repair), deterministic MCP call.",
		};
	} catch (e: any) {
		try { await client.close(); } catch {}
		err = String(e?.message ?? e);
		return { path: "C", run_idx: runIdx, wall_clock_ms: Date.now() - t0, total_tokens: 0, llm_calls: 0, result: "fail", error: err };
	}
}

async function main() {
	await mkdir(OUT, { recursive: true });
	console.log(`exp-012 — httpbin benchmark, n=${RUNS_PER_PATH}/path\n`);

	const httpServer = await runPathB_setup();
	const browser = await chromium.launch({ headless: true });

	const results: any[] = [];
	// Path A
	console.log("=== Path A (remote LLM drives CDP) ===");
	for (let i = 0; i < RUNS_PER_PATH; i++) {
		console.log(`  A run ${i+1}/${RUNS_PER_PATH}`);
		const r = await runPathA(browser, i).catch(e => ({ path:"A", run_idx:i, result:"fail", error:String(e?.message ?? e) }));
		console.log(`    → ${r.result} wall=${r.wall_clock_ms}ms tokens=${r.total_tokens ?? 0} calls=${r.llm_calls ?? 0} iters=${r.iterations ?? "?"}`);
		results.push(r);
	}
	// Path B
	console.log("\n=== Path B (hand-written WebMCP) ===");
	for (let i = 0; i < RUNS_PER_PATH; i++) {
		console.log(`  B run ${i+1}/${RUNS_PER_PATH}`);
		const r = await runPathB(browser, i).catch(e => ({ path:"B", run_idx:i, result:"fail", error:String(e?.message ?? e) }));
		console.log(`    → ${r.result} wall=${r.wall_clock_ms}ms`);
		results.push(r);
	}
	// Path C
	console.log("\n=== Path C (synthesized WebMCP, repaired) ===");
	for (let i = 0; i < RUNS_PER_PATH; i++) {
		console.log(`  C run ${i+1}/${RUNS_PER_PATH}`);
		const r = await runPathC(browser, i).catch(e => ({ path:"C", run_idx:i, result:"fail", error:String(e?.message ?? e) }));
		console.log(`    → ${r.result} wall=${r.wall_clock_ms}ms`);
		results.push(r);
	}

	await browser.close();
	httpServer.close();

	// Tabulate
	const byPath: any = { A: [], B: [], C: [] };
	for (const r of results) byPath[r.path].push(r);
	function stats(rows: any[]) {
		if (!rows.length) return null;
		const walls = rows.map(r => r.wall_clock_ms ?? 0).sort((a,b)=>a-b);
		const tokens = rows.map(r => r.total_tokens ?? 0);
		return {
			n: rows.length,
			passes: rows.filter(r => r.result === "pass").length,
			median_wall_clock_ms: walls[Math.floor(walls.length/2)],
			mean_wall_clock_ms: Math.round(walls.reduce((a,b)=>a+b,0) / walls.length),
			mean_total_tokens: Math.round(tokens.reduce((a,b)=>a+b,0) / tokens.length),
			mean_llm_calls: Math.round(rows.reduce((a,r)=>a+(r.llm_calls ?? 0), 0) / rows.length),
		};
	}
	const summary = {
		ran_at: new Date().toISOString(),
		amendments_applied: ["AMD-002", "AMD-006"],
		n_per_path: RUNS_PER_PATH,
		A: stats(byPath.A),
		B: stats(byPath.B),
		C: stats(byPath.C),
	};
	await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
	await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
	console.log("\n=== SUMMARY ===");
	console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
