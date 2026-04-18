#!/usr/bin/env bun
/**
 * Re-validate exp-002b outputs with a more honest scorer that distinguishes:
 *   - strict: passes the original CONTRACT.md validation as written
 *   - intent_shaped: the tool shape is correct (>=2 ops, has non-read, has arg placeholders) — even if inputSchema is structurally broken
 *   - trivial: an element-catalog style (single op, no args)
 */
import { readdir, readFile, writeFile } from "node:fs/promises";

const outDir = import.meta.dir + "/out";
const files = (await readdir(outDir)).filter(f => f.endsWith(".json") && f !== "summary.json");
const DSL = new Set(["click","fill","select","check","submit","read"]);
const ROLES_STRICT = new Set(["button","textbox","combobox","link","checkbox","radio","heading","img","list","listitem","table","cell","form","region","dialog","tab","tabpanel","navigation","status"]);
const ROLES_PRAGMATIC = new Set([...ROLES_STRICT, "option","menu","menuitem","switch","searchbox","tooltip","span","div","article","section","main","banner","contentinfo"]);

const rows: any[] = [];
for (const f of files) {
	const j = JSON.parse(await readFile(`${outDir}/${f}`, "utf8"));
	const tools = j.spec?.tools ?? [];
	let strict = 0, intentShaped = 0, trivial = 0, structurallyBroken = 0;
	const examples: any[] = [];
	for (const t of tools) {
		if (!Array.isArray(t.dsl)) continue;
		const propsDeclared = Object.keys(t.inputSchema?.properties ?? {});
		const hasPlaceholders = t.dsl.some((op: any) => typeof op.value === "string" && /\{\{\w+\}\}/.test(op.value));
		const placeholderRefs = new Set<string>();
		for (const op of t.dsl) {
			if (typeof op.value === "string") {
				for (const m of op.value.matchAll(/\{\{(\w+)\}\}/g)) placeholderRefs.add(m[1]);
			}
		}
		const hasNonRead = t.dsl.some((op: any) => op.op !== "read");
		const allOpsValid = t.dsl.every((op: any) => DSL.has(op.op));
		const allRolesStrict = t.dsl.every((op: any) => ROLES_STRICT.has(op.target?.role));
		const allRolesPragmatic = t.dsl.every((op: any) => ROLES_PRAGMATIC.has(op.target?.role));
		const multiOp = t.dsl.length >= 2;
		const hasArgs = propsDeclared.length >= 1 || placeholderRefs.size >= 1;

		// Strict: original CONTRACT says inputSchema.properties must have keys, all roles in strict set, placeholder coverage etc.
		const strictOk =
			multiOp && hasNonRead && allOpsValid && allRolesStrict &&
			propsDeclared.length >= 1 &&
			[...placeholderRefs].every(r => propsDeclared.includes(r));

		// Intent-shaped: the tool is conceptually right even if inputSchema is malformed (e.g. `required` has names that should be in `properties`).
		const intentOk =
			multiOp && hasNonRead && allOpsValid && allRolesPragmatic &&
			(hasPlaceholders || hasArgs);

		if (strictOk) { strict++; examples.push({ tag:"strict", name: t.name, ops: t.dsl.length, risk: t.risk }); }
		else if (intentOk) { intentShaped++; examples.push({ tag:"intent", name: t.name, ops: t.dsl.length, risk: t.risk, issue: !allRolesStrict ? "pragmatic-role" : propsDeclared.length === 0 ? "inputSchema-malformed" : "other" }); structurallyBroken++; }
		else { trivial++; examples.push({ tag:"trivial", name: t.name, ops: t.dsl.length }); }
	}
	rows.push({ slug: j.slug, url: j.url, latency_ms: j.latency_ms, tool_count: tools.length, strict, intent_shaped: intentShaped, trivial, examples });
}

const totals = {
	n_urls: rows.length,
	total_tools: rows.reduce((a,r)=>a+r.tool_count, 0),
	strict_total: rows.reduce((a,r)=>a+r.strict, 0),
	intent_shaped_total: rows.reduce((a,r)=>a+r.intent_shaped, 0),
	trivial_total: rows.reduce((a,r)=>a+r.trivial, 0),
	any_intent_total: rows.reduce((a,r)=>a+r.strict+r.intent_shaped, 0),
	urls_with_any_intent: rows.filter(r => r.strict + r.intent_shaped > 0).length,
};
const out = { ran_at: new Date().toISOString(), totals, rows };
await writeFile(`${outDir}/revalidation.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ totals, per_url: rows.map(r => ({ slug: r.slug, strict: r.strict, intent: r.intent_shaped, trivial: r.trivial })) }, null, 2));
