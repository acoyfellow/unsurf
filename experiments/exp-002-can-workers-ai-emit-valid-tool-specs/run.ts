#!/usr/bin/env bun
/**
 * exp-002 runner — Workers AI synthesis of tool-spec.v0.json
 *
 * Amendments applied: AMD-004 (skip Claude Sonnet baseline), AMD-005 (logged-in SaaS substitutions)
 *
 * Design notes (v2 after hang):
 * - Workers AI with response_format JSON schema is SLOW (30-150s per call).
 * - Per-request timeout is 180s. After, we record as timeout + skip.
 * - Each (url, model) writes its own result file IMMEDIATELY on completion so partial runs are visible.
 * - Concurrency = 2 (one per model) to not hammer the AI binding.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

const SYNTH_URL = "http://127.0.0.1:8890/run";
const REQUEST_TIMEOUT_MS = 180_000;
const MODELS = [
	"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	"@cf/qwen/qwen2.5-coder-32b-instruct",
];

const URLS: { slug: string; url: string; note?: string }[] = [
	{ slug: "httpbin-forms-post", url: "https://httpbin.org/forms/post", note: "classic HTML form baseline" },
	{ slug: "duckduckgo", url: "https://duckduckgo.com/", note: "search form" },
	{ slug: "example-com", url: "https://example.com/", note: "static control" },
	{ slug: "hn-item", url: "https://news.ycombinator.com/item?id=1", note: "comment form, server-rendered" },
	{ slug: "midjourney-explore", url: "https://www.midjourney.com/explore", note: "AMD-005: SaaS feed (no login on unauth fetch, app shell only)" },
	{ slug: "coey-projects", url: "https://coey.dev/projects", note: "AMD-005: personal site" },
];

const TOOL_SPEC_SCHEMA = {
	type: "object",
	properties: {
		version: { type: "string", enum: ["v0"] },
		url: { type: "string" },
		tools: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					inputSchema: {
						type: "object",
						properties: {
							type: { type: "string", enum: ["object"] },
							properties: { type: "object" },
							required: { type: "array", items: { type: "string" } },
						},
						required: ["type", "properties"],
					},
					dsl: {
						type: "array",
						items: {
							type: "object",
							properties: {
								op: { type: "string", enum: ["click", "fill", "select", "check", "submit", "read"] },
								target: {
									type: "object",
									properties: {
										role: { type: "string" },
										name: { type: "string" },
										nth: { type: "integer" },
									},
									required: ["role", "name"],
								},
								value: {},
							},
							required: ["op", "target"],
						},
					},
					risk: { type: "string", enum: ["low", "medium", "high"] },
				},
				required: ["name", "description", "inputSchema", "dsl", "risk"],
			},
		},
	},
	required: ["version", "url", "tools"],
};

const SYSTEM_PROMPT = `You are a WebMCP tool synthesizer.

Given the cleaned DOM of a single webpage, emit a tool-spec.v0.json describing the actionable tools on that page.

Rules:
- version MUST be "v0".
- tools[].dsl[].op MUST be one of: click, fill, select, check, submit, read.
- tools[].dsl[].target.role MUST be from this closed set: button, textbox, combobox, link, checkbox, radio, heading, img, list, listitem, table, cell, form, region, dialog, tab, tabpanel, navigation, status.
- tools[].dsl[].target.name is the accessible name of the element (from aria-label, associated label, or visible text of a button/link).
- DO NOT use CSS selectors, XPath, or element IDs.
- If you cannot determine a role or a stable accessible name for a target, do NOT emit that tool.
- tools[].inputSchema MUST be a JSON Schema object (type:"object"). Properties must match {{placeholder}} refs in dsl[].value.
- tools[].risk:
  - low: all ops are "read"
  - medium: includes click/fill/select/check but NOT "submit" and NO destructive verbs
  - high: includes "submit" OR click whose target.name contains delete/remove/pay/buy/send/confirm/destroy/cancel
- Prefer FEWER high-quality tools. Empty tools array is valid.
- Tool names: snake_case, unique.

Reply with ONLY the JSON object. No prose, no markdown, no backticks.`;

function sha256(s: string): string {
	return "sha256:" + createHash("sha256").update(s).digest("hex");
}

function clean(html: string): string {
	let s = html;
	s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
	s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
	s = s.replace(/<svg[\s\S]*?<\/svg>/gi, "");
	s = s.replace(/<!--[\s\S]*?-->/g, "");
	s = s.replace(/\s+/g, " ");
	if (s.length > 24000) s = s.slice(0, 24000) + "\n<!-- truncated -->";
	return s;
}

async function fetchHtml(url: string) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 15000);
	try {
		const r = await fetch(url, {
			signal: ctrl.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
				"Accept": "text/html,*/*",
			},
			redirect: "follow",
		});
		const html = await r.text();
		return { ok: r.ok, html, status: r.status, bytes: html.length };
	} catch (e: any) {
		return { ok: false, html: "", status: 0, bytes: 0, err: String(e?.message ?? e) };
	} finally {
		clearTimeout(t);
	}
}

async function synth(model: string, url: string, cleanedDom: string) {
	const t0 = Date.now();
	const ctrl = new AbortController();
	const to = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
	try {
		const r = await fetch(SYNTH_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model,
				system: SYSTEM_PROMPT,
				user: `url: ${url}\n\ncleaned DOM:\n${cleanedDom}`,
				schema: TOOL_SPEC_SCHEMA,
				max_tokens: 2048,
				temperature: 0.2,
			}),
			signal: ctrl.signal,
		});
		const bodyText = await r.text();
		let body: any = null;
		try { body = JSON.parse(bodyText); } catch { /* keep raw */ }
		return { latency_ms: Date.now() - t0, status: r.status, ok: r.ok, body, raw: bodyText.slice(0, 4096) };
	} catch (e: any) {
		return { latency_ms: Date.now() - t0, status: 0, ok: false, body: null, err: String(e?.message ?? e) };
	} finally {
		clearTimeout(to);
	}
}

function validateSpec(spec: any) {
	const errors: string[] = [];
	if (!spec || typeof spec !== "object") return { ok: false, errors: ["not an object"], tool_count: 0, nontrivial_count: 0 };
	if (spec.version !== "v0") errors.push(`version≠v0`);
	if (!spec.url) errors.push("missing url");
	if (!Array.isArray(spec.tools)) errors.push("tools not array");
	let tool_count = 0, nontrivial = 0;
	const DSL_OPS = new Set(["click","fill","select","check","submit","read"]);
	const ROLES = new Set(["button","textbox","combobox","link","checkbox","radio","heading","img","list","listitem","table","cell","form","region","dialog","tab","tabpanel","navigation","status"]);
	if (Array.isArray(spec.tools)) {
		tool_count = spec.tools.length;
		const names = new Set<string>();
		for (const [i, t] of spec.tools.entries()) {
			if (!t.name || !/^[a-z][a-z0-9_]*$/.test(t.name)) errors.push(`t${i}.name invalid`);
			if (names.has(t.name)) errors.push(`t${i}.name dup`);
			names.add(t.name);
			if (!t.description) errors.push(`t${i}.desc missing`);
			if (!["low","medium","high"].includes(t.risk)) errors.push(`t${i}.risk ${t.risk}`);
			if (!Array.isArray(t.dsl)) errors.push(`t${i}.dsl not array`);
			let hasNonRead = false;
			if (Array.isArray(t.dsl)) {
				for (const [j, op] of t.dsl.entries()) {
					if (!DSL_OPS.has(op.op)) errors.push(`t${i}.dsl[${j}].op ${op.op}`);
					if (!op.target || !ROLES.has(op.target.role)) errors.push(`t${i}.dsl[${j}].role ${op.target?.role}`);
					if (!op.target?.name) errors.push(`t${i}.dsl[${j}].name missing`);
					if (op.op !== "read") hasNonRead = true;
				}
			}
			if (Array.isArray(t.dsl) && t.inputSchema?.properties) {
				const declared = new Set(Object.keys(t.inputSchema.properties));
				for (const op of t.dsl) {
					if (typeof op.value === "string") {
						const refs = [...op.value.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]);
						for (const r of refs) if (!declared.has(r)) errors.push(`t${i} placeholder ${r}`);
					}
				}
			}
			if (Array.isArray(t.dsl) && t.dsl.length >= 2 && hasNonRead && t.inputSchema?.properties && Object.keys(t.inputSchema.properties).length >= 1) {
				nontrivial++;
			}
		}
	}
	return { ok: errors.length === 0, errors, tool_count, nontrivial_count: nontrivial };
}

async function runOne(u: { slug: string; url: string; note?: string }, model: string, outDir: string, promptHash: string) {
	const modelSlug = model.includes("llama") ? "llama" : "qwen";
	const outFile = `${outDir}/out/${modelSlug}/${u.slug}.json`;
	if (existsSync(outFile)) {
		console.log(`  [skip-cached] ${u.slug} ${modelSlug}`);
		const cached = JSON.parse(await readFile(outFile, "utf8"));
		return { ...cached, skipped_cached: true, slug: u.slug, url: u.url, model };
	}

	console.log(`  → ${u.slug} ${modelSlug}`);
	const fetched = await fetchHtml(u.url);
	if (!fetched.ok || !fetched.html) {
		const out = {
			slug: u.slug, url: u.url, model, error: `fetch status=${fetched.status} ${(fetched as any).err ?? ""}`,
			latency_ms: 0, validation: { ok: false, errors: [`fetch failed`], tool_count: 0, nontrivial_count: 0 },
			spec: null,
		};
		await writeFile(outFile, JSON.stringify(out, null, 2));
		console.log(`    ✗ fetch failed status=${fetched.status}`);
		return out;
	}
	const cleaned = clean(fetched.html);
	const fp = sha256(cleaned);
	const s = await synth(model, u.url, cleaned);

	let spec: any = null;
	if (s.body?.result?.response) {
		spec = s.body.result.response;
		if (typeof spec === "string") { try { spec = JSON.parse(spec); } catch {} }
	} else if (s.body?.result) {
		spec = s.body.result;
	}
	if (spec && typeof spec === "object") {
		spec.version ??= "v0";
		spec.url ??= u.url;
		spec.fingerprint ??= fp;
		spec.fingerprintStrategy ??= "sha256-cleaned-dom-v0";
		spec.synthesizedAt ??= new Date().toISOString();
		spec.synthesizer ??= { name: "exp-002", model, promptHash };
	}
	const v = validateSpec(spec);
	const out = {
		slug: u.slug, url: u.url, model, note: u.note,
		latency_ms: s.latency_ms, status: s.status, ok: s.ok,
		validation: v, spec,
		...(s.err ? { err: s.err } : {}),
		...(s.body?.error ? { synth_err: s.body.error } : {}),
		fetch_bytes: fetched.bytes, cleaned_bytes: cleaned.length,
	};
	await writeFile(outFile, JSON.stringify(out, null, 2));
	console.log(`    ${v.ok ? "✓" : "✗"} latency=${s.latency_ms}ms tools=${v.tool_count} nontrivial=${v.nontrivial_count}${v.errors.length ? ` errs=${v.errors.slice(0,3).join("; ")}` : ""}`);
	return out;
}

async function main() {
	const outDir = import.meta.dir;
	await mkdir(`${outDir}/out/llama`, { recursive: true });
	await mkdir(`${outDir}/out/qwen`, { recursive: true });
	await mkdir(`${outDir}/samples`, { recursive: true });

	const promptHash = sha256(SYSTEM_PROMPT);
	console.log(`exp-002 — ${URLS.length} URLs × ${MODELS.length} models = ${URLS.length * MODELS.length} synths (concurrency 2, timeout ${REQUEST_TIMEOUT_MS/1000}s)\n`);

	const all: any[] = [];
	// Two concurrent workers, one per model, iterating URLs
	await Promise.all(MODELS.map(async (model) => {
		for (const u of URLS) {
			try {
				const r = await runOne(u, model, outDir, promptHash);
				all.push(r);
			} catch (e: any) {
				console.log(`    ✗ runOne threw: ${e?.message ?? e}`);
				all.push({ slug: u.slug, url: u.url, model, error: String(e?.message ?? e) });
			}
		}
	}));

	// Metrics + summary
	const byModel: Record<string, any> = {};
	for (const r of all) {
		byModel[r.model] ??= { model: r.model, total: 0, valid: 0, nontrivial: 0, lat_sum: 0, lat_n: 0 };
		byModel[r.model].total++;
		if (r.validation?.ok) byModel[r.model].valid++;
		byModel[r.model].nontrivial += r.validation?.nontrivial_count ?? 0;
		if (r.latency_ms > 0) { byModel[r.model].lat_sum += r.latency_ms; byModel[r.model].lat_n++; }
		if (r.validation?.ok && r.validation.nontrivial_count > 0) {
			const modelSlug = r.model.includes("llama") ? "llama" : "qwen";
			await writeFile(`${outDir}/samples/${r.slug}.${modelSlug}.tool-spec.v0.json`, JSON.stringify(r.spec, null, 2));
		}
	}
	const perModelTotals = Object.values(byModel).map((x: any) => ({
		...x,
		mean_latency_ms: x.lat_n ? Math.round(x.lat_sum/x.lat_n) : null,
		validity_rate: (x.valid/x.total).toFixed(2),
	}));
	const summary = {
		ran_at: new Date().toISOString(),
		amendments_applied: ["AMD-004","AMD-005"],
		n_urls: URLS.length,
		models: MODELS,
		per_model_totals: perModelTotals,
	};
	await writeFile(`${outDir}/out/summary.json`, JSON.stringify(summary, null, 2));
	const csvHead = "slug,url,model,latency_ms,schema_valid,tool_count,nontrivial_count,errors";
	const csvRows = all.map(r => [r.slug, r.url, r.model, r.latency_ms ?? 0, r.validation?.ok ?? false, r.validation?.tool_count ?? 0, r.validation?.nontrivial_count ?? 0, (r.validation?.errors ?? []).slice(0,3).join("|")].map(v => `"${String(v).replace(/"/g,'""')}"`).join(","));
	await writeFile(`${outDir}/out/metrics.csv`, [csvHead, ...csvRows].join("\n"));
	console.log("\n== SUMMARY ==");
	console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
