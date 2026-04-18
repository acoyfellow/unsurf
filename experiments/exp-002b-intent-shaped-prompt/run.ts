#!/usr/bin/env bun
/**
 * exp-002b — intent-shaped synthesis prompt, Qwen only.
 * Follow-up to exp-002 FAIL (0 nontrivial tools). Prompt revised to ask for user INTENTS, not page elements.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const SYNTH_URL = "http://127.0.0.1:8890/run";
const MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const REQUEST_TIMEOUT_MS = 180_000;

const URLS = [
	{ slug: "httpbin-forms-post", url: "https://httpbin.org/forms/post" },
	{ slug: "duckduckgo", url: "https://duckduckgo.com/" },
	{ slug: "example-com", url: "https://example.com/" },
	{ slug: "hn-item", url: "https://news.ycombinator.com/item?id=1" },
	{ slug: "midjourney-explore", url: "https://www.midjourney.com/explore" },
	{ slug: "coey-projects", url: "https://coey.dev/projects" },
];

const TOOL_SPEC_SCHEMA = {
	type: "object",
	properties: {
		version: { type: "string", enum: ["v0"] },
		url: { type: "string" },
		tools: {
			type: "array",
			maxItems: 3,
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					inputSchema: {
						type: "object",
						properties: {
							type: { type: "string", enum: ["object"] },
							properties: { type: "object", minProperties: 1 },
							required: { type: "array", items: { type: "string" } },
						},
						required: ["type", "properties", "required"],
					},
					dsl: {
						type: "array",
						minItems: 2,
						items: {
							type: "object",
							properties: {
								op: { type: "string", enum: ["click","fill","select","check","submit","read"] },
								target: {
									type: "object",
									properties: {
										role: { type: "string" },
										name: { type: "string" },
										nth: { type: "integer" },
									},
									required: ["role","name"],
								},
								value: {},
							},
							required: ["op","target"],
						},
					},
					risk: { type: "string", enum: ["low","medium","high"] },
				},
				required: ["name","description","inputSchema","dsl","risk"],
			},
		},
	},
	required: ["version","url","tools"],
};

const SYSTEM_PROMPT = `You are a WebMCP tool synthesizer focused on USER INTENT.

For the given webpage, think about what a USER would want to ACCOMPLISH on it, then emit 0-3 tools — at most 3, often fewer, sometimes zero.

A good tool represents a COMPLETE USER TASK:
- "submit_contact_form(name, email, message)" — good
- "search(query)" — good
- "click_nav_link" — bad (just an element catalog, no user value)
- "read_page_title" — bad (trivial, no arguments)

STRICT REQUIREMENTS for each tool:
1. inputSchema.properties MUST have >= 1 property. Tools with no arguments are FORBIDDEN.
2. dsl MUST have >= 2 operations. Single-op tools are FORBIDDEN.
3. DSL ops: click, fill, select, check, submit, read.
4. Target.role from: button, textbox, combobox, link, checkbox, radio, heading, img, list, listitem, table, cell, form, region, dialog, tab, tabpanel, navigation, status.
5. Target.name = the accessible name (label, aria-label, or visible text).
6. Placeholders in dsl[].value as {{argName}} must match inputSchema.properties keys.
7. risk: low (all reads) | medium (interactions, no submits) | high (submits or destructive verbs).

If the page has no clear user task — for example, a static landing page with just links — emit tools: [] and STOP. Empty is better than trivial.

Reply with ONLY the JSON object. No prose, no markdown.`;

function sha256(s: string) { return "sha256:" + createHash("sha256").update(s).digest("hex"); }
function clean(html: string) {
	let s = html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<svg[\s\S]*?<\/svg>/gi,"").replace(/<!--[\s\S]*?-->/g,"").replace(/\s+/g," ");
	return s.length > 24000 ? s.slice(0,24000)+"\n<!--truncated-->" : s;
}

async function fetchHtml(url: string) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 15000);
	try {
		const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent":"Mozilla/5.0 Chrome/132" }, redirect:"follow" });
		const html = await r.text();
		return { ok: r.ok, html, status: r.status, bytes: html.length };
	} catch (e: any) { return { ok:false, html:"", status:0, bytes:0, err:String(e?.message ?? e) }; }
	finally { clearTimeout(t); }
}

async function synth(url: string, cleanedDom: string) {
	const t0 = Date.now();
	const ctrl = new AbortController();
	const to = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
	try {
		const r = await fetch(SYNTH_URL, {
			method:"POST",
			headers:{"content-type":"application/json"},
			body: JSON.stringify({
				model: MODEL, system: SYSTEM_PROMPT,
				user: `url: ${url}\n\ncleaned DOM:\n${cleanedDom}`,
				schema: TOOL_SPEC_SCHEMA, max_tokens: 1536, temperature: 0.1,
			}),
			signal: ctrl.signal,
		});
		const text = await r.text();
		let body: any = null;
		try { body = JSON.parse(text); } catch {}
		return { latency_ms: Date.now()-t0, ok: r.ok, body, raw: text.slice(0,4096) };
	} catch (e: any) { return { latency_ms: Date.now()-t0, ok:false, body:null, err:String(e?.message ?? e) }; }
	finally { clearTimeout(to); }
}

function validate(spec: any) {
	const errors: string[] = [];
	if (!spec || typeof spec !== "object") return { ok:false, errors:["not object"], tool_count:0, nontrivial:0 };
	if (spec.version !== "v0") errors.push("version≠v0");
	if (!Array.isArray(spec.tools)) errors.push("tools not array");
	const DSL = new Set(["click","fill","select","check","submit","read"]);
	const ROLES = new Set(["button","textbox","combobox","link","checkbox","radio","heading","img","list","listitem","table","cell","form","region","dialog","tab","tabpanel","navigation","status","option"]); // include option per exp-002 BACKLOG note (pragmatic)
	let nontrivial = 0;
	if (Array.isArray(spec.tools)) {
		for (const [i, t] of spec.tools.entries()) {
			if (!t.name || !/^[a-z][a-z0-9_]*$/.test(t.name)) errors.push(`t${i}.name`);
			if (!["low","medium","high"].includes(t.risk)) errors.push(`t${i}.risk`);
			const props = t.inputSchema?.properties ?? {};
			const propCount = Object.keys(props).length;
			let hasNonRead = false, okOps = true;
			if (Array.isArray(t.dsl)) {
				for (const op of t.dsl) {
					if (!DSL.has(op.op)) { errors.push(`t${i} op ${op.op}`); okOps = false; }
					if (op.op !== "read") hasNonRead = true;
				}
			} else errors.push(`t${i}.dsl not array`);
			if (Array.isArray(t.dsl) && t.dsl.length >= 2 && hasNonRead && propCount >= 1 && okOps) nontrivial++;
		}
	}
	return { ok: errors.length === 0, errors, tool_count: spec.tools?.length ?? 0, nontrivial };
}

async function main() {
	const outDir = import.meta.dir;
	await mkdir(`${outDir}/out`, { recursive: true });
	await mkdir(`${outDir}/samples`, { recursive: true });
	const promptHash = sha256(SYSTEM_PROMPT);
	console.log(`exp-002b — Qwen + intent-shaped prompt, ${URLS.length} URLs, timeout ${REQUEST_TIMEOUT_MS/1000}s`);

	const rows: any[] = [];
	for (const u of URLS) {
		const f = `${outDir}/out/${u.slug}.json`;
		console.log(`→ ${u.slug}`);
		const fetched = await fetchHtml(u.url);
		if (!fetched.ok) { console.log(`  ✗ fetch ${fetched.status}`); rows.push({slug:u.slug, err:fetched.status}); continue; }
		const cleaned = clean(fetched.html);
		const s = await synth(u.url, cleaned);
		let spec: any = s.body?.result?.response ?? s.body?.result;
		if (typeof spec === "string") { try { spec = JSON.parse(spec); } catch {} }
		if (spec && typeof spec === "object") {
			spec.version ??= "v0"; spec.url ??= u.url;
			spec.synthesizer ??= { name: "exp-002b", model: MODEL, promptHash };
			spec.fingerprint ??= sha256(cleaned);
			spec.fingerprintStrategy ??= "sha256-cleaned-dom-v0";
			spec.synthesizedAt ??= new Date().toISOString();
		}
		const v = validate(spec);
		await writeFile(f, JSON.stringify({ slug:u.slug, url:u.url, latency_ms:s.latency_ms, validation:v, spec, err:s.err, body_error:s.body?.error }, null, 2));
		console.log(`  ${v.nontrivial>0?"✓":"·"} lat=${s.latency_ms}ms tools=${v.tool_count} nontrivial=${v.nontrivial}${v.errors.length?` errs=${v.errors.slice(0,2).join(";")}`:""}`);
		rows.push({ slug:u.slug, latency_ms:s.latency_ms, tools:v.tool_count, nontrivial:v.nontrivial, valid:v.ok });
		if (v.nontrivial > 0 && spec) {
			await writeFile(`${outDir}/samples/${u.slug}.tool-spec.v0.json`, JSON.stringify(spec, null, 2));
		}
	}

	const totalNontrivial = rows.reduce((a,r)=>a+(r.nontrivial ?? 0), 0);
	const validCount = rows.filter(r=>r.valid).length;
	const summary = {
		ran_at: new Date().toISOString(),
		model: MODEL, n_urls: URLS.length,
		total_tools: rows.reduce((a,r)=>a+(r.tools ?? 0), 0),
		total_nontrivial: totalNontrivial,
		valid_count: validCount,
		mean_latency_ms: Math.round(rows.filter(r=>r.latency_ms>0).reduce((a,r)=>a+r.latency_ms,0) / Math.max(1, rows.filter(r=>r.latency_ms>0).length)),
		verdict: totalNontrivial >= 3 ? "PASS" : totalNontrivial >= 1 ? "AMBIGUOUS" : "FAIL",
	};
	await writeFile(`${outDir}/out/summary.json`, JSON.stringify(summary, null, 2));
	console.log("\n=== SUMMARY ===\n" + JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
