#!/usr/bin/env bun
/**
 * exp-003 runner — 6-verb DSL executor using Playwright role+name resolution.
 *
 * For each spec:
 *   - Launch fresh browser context.
 *   - Navigate to spec.url.
 *   - Execute each dsl op in order.
 *   - Record per-op result, per-spec outcome, postcondition check.
 *   - Write per-spec JSON + summary matrix.
 *
 * HITL gate: any tool with risk:"high" is SKIPPED in this autonomous run (no user in the loop to confirm).
 * We record that the tool was correctly gated, not executed.
 */

import { chromium, type Browser, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { SPECS, type DslOp, type Target, type Postcondition, type ToolSpec } from "./specs";

const OUT = import.meta.dir + "/out";

function substitute(value: any, args: Record<string, any>): any {
	if (typeof value !== "string") return value;
	return value.replace(/\{\{(\w+)\}\}/g, (_m, k) => (args[k] !== undefined ? String(args[k]) : `{{${k}}}`));
}

function hasHighRisk(spec: ToolSpec): boolean {
	return spec.tools.some((t) => t.risk === "high");
}

// Role+name resolver using Playwright's getByRole.
// Returns a Locator + a diagnostic of how it was resolved.
async function resolve(page: Page, target: Target, timeout: number = 4000): Promise<{ locator: any | null; via: string; count: number }> {
	const roleMap: Record<string, any> = {
		button: "button",
		textbox: "textbox",
		combobox: "combobox",
		link: "link",
		checkbox: "checkbox",
		radio: "radio",
		heading: "heading",
		img: "img",
		list: "list",
		listitem: "listitem",
		table: "table",
		cell: "cell",
		form: "form",
		region: "region",
		dialog: "dialog",
		tab: "tab",
		tabpanel: "tabpanel",
		navigation: "navigation",
		status: "status",
		searchbox: "searchbox",
		option: "option",
		menu: "menu",
		menuitem: "menuitem",
		switch: "switch",
	};
	const role = roleMap[target.role];
	if (!role) return { locator: null, via: `unknown role ${target.role}`, count: 0 };

	// 1) Role + exact name
	let loc = page.getByRole(role, { name: target.name, exact: true });
	if (typeof target.nth === "number") loc = loc.nth(target.nth);
	try {
		await loc.waitFor({ state: "attached", timeout });
		const count = await loc.count();
		if (count >= 1) return { locator: loc, via: "role+name-exact", count };
	} catch {}

	// 2) Role + case-insensitive contains
	loc = page.getByRole(role, { name: target.name });
	if (typeof target.nth === "number") loc = loc.nth(target.nth);
	try {
		await loc.waitFor({ state: "attached", timeout: 2000 });
		const count = await loc.count();
		if (count >= 1) return { locator: loc, via: "role+name-loose", count };
	} catch {}

	return { locator: null, via: "not-resolved", count: 0 };
}

async function runOp(page: Page, op: DslOp, args: Record<string, any>, toolName: string, opIndex: number): Promise<any> {
	const out: any = { op: op.op, target: op.target, opIndex };
	const r = await resolve(page, op.target);
	out.resolver = { via: r.via, count: r.count };
	if (!r.locator) return { ...out, status: "resolver_failed", error: `resolver could not find ${op.op}:${op.target.role}:${op.target.name}` };

	try {
		if (op.op === "click") {
			await r.locator.click({ timeout: 8000 });
			return { ...out, status: "ok" };
		}
		if (op.op === "fill") {
			const v = substitute((op as any).value, args);
			await r.locator.fill(v, { timeout: 8000 });
			return { ...out, status: "ok", value_substituted: v };
		}
		if (op.op === "select") {
			const v = substitute((op as any).value, args);
			await r.locator.selectOption(v, { timeout: 8000 });
			return { ...out, status: "ok", value: v };
		}
		if (op.op === "check") {
			const v = (op as any).value;
			if (v) await r.locator.check({ timeout: 8000 });
			else await r.locator.uncheck({ timeout: 8000 });
			return { ...out, status: "ok", value: v };
		}
		if (op.op === "submit") {
			// Press Enter on the element, OR submit the form
			try {
				const tag = await r.locator.evaluate((el: Element) => el.tagName.toLowerCase());
				if (tag === "form") {
					await r.locator.evaluate((el: HTMLFormElement) => el.requestSubmit ? el.requestSubmit() : el.submit());
				} else {
					await r.locator.press("Enter", { timeout: 8000 });
				}
				return { ...out, status: "ok" };
			} catch (e: any) {
				return { ...out, status: "action_failed", error: String(e?.message ?? e) };
			}
		}
		if (op.op === "read") {
			const as = (op as any).as;
			if (as === "text") {
				const text = await r.locator.innerText({ timeout: 4000 });
				return { ...out, status: "ok", read_value: text.slice(0, 200) };
			}
			if (as === "value") {
				const val = await r.locator.inputValue({ timeout: 4000 });
				return { ...out, status: "ok", read_value: val };
			}
			if (as === "attr") {
				const val = await r.locator.getAttribute((op as any).attr, { timeout: 4000 });
				return { ...out, status: "ok", read_value: val };
			}
			return { ...out, status: "action_failed", error: "invalid read as" };
		}
		return { ...out, status: "action_failed", error: `unknown op ${op.op}` };
	} catch (e: any) {
		return { ...out, status: "action_failed", error: String(e?.message ?? e) };
	}
}

async function checkPostcondition(page: Page, pc: Postcondition | undefined): Promise<{ kind: string; ok: boolean; detail?: string }> {
	if (!pc) return { kind: "none", ok: true };
	if (pc.kind === "textPresent") {
		try {
			const text = await page.evaluate(() => document.body?.innerText ?? "");
			return { kind: "textPresent", ok: text.toLowerCase().includes(pc.value.toLowerCase()), detail: `query="${pc.value}"` };
		} catch (e: any) { return { kind: "textPresent", ok: false, detail: String(e?.message ?? e) }; }
	}
	if (pc.kind === "urlMatches") {
		const url = page.url();
		return { kind: "urlMatches", ok: new RegExp(pc.pattern).test(url), detail: `url=${url}` };
	}
	if (pc.kind === "elementExists") {
		const r = await resolve(page, pc.target, 2000);
		return { kind: "elementExists", ok: r.count >= 1, detail: r.via };
	}
	return { kind: "unknown", ok: false };
}

async function runSpec(browser: Browser, entry: typeof SPECS[number]) {
	const { slug, url, args, spec } = entry;
	const ctx = await browser.newContext({
		userAgent: "Mozilla/5.0 (Macintosh) Chrome/132 exp-003",
		bypassCSP: true,
	});
	const page = await ctx.newPage();
	const report: any = { slug, url, tools: [], postconditions: [], nav_error: null };
	try {
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
		await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
	} catch (e: any) {
		report.nav_error = String(e?.message ?? e);
		await ctx.close();
		return report;
	}

	for (const [ti, tool] of spec.tools.entries()) {
		const toolReport: any = { name: tool.name, risk: tool.risk, ops: [], hitl_gated: false, postcondition: null };
		if (tool.risk === "high") {
			toolReport.hitl_gated = true;
			toolReport.note = "risk=high; skipped in autonomous run per CONTRACT HITL rule";
			report.tools.push(toolReport);
			continue;
		}
		for (const [oi, op] of tool.dsl.entries()) {
			const r = await runOp(page, op, args, tool.name, oi);
			toolReport.ops.push(r);
			if (r.status !== "ok") break; // stop on first failure
		}
		const allOk = toolReport.ops.every((o: any) => o.status === "ok");
		if (allOk) {
			const pc = await checkPostcondition(page, tool.postcondition);
			toolReport.postcondition = pc;
		}
		report.tools.push(toolReport);
	}

	await ctx.close();
	return report;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	console.log(`exp-003 — ${SPECS.length} specs, chromium headless`);
	const reports: any[] = [];
	for (const [i, entry] of SPECS.entries()) {
		console.log(`\n[${i+1}/${SPECS.length}] ${entry.slug}`);
		try {
			const r = await runSpec(browser, entry);
			reports.push(r);
			// Print per-spec summary
			for (const t of r.tools) {
				if (t.hitl_gated) {
					console.log(`   · ${t.name} risk=${t.risk} HITL-gated (autonomous skip)`);
					continue;
				}
				const okCount = t.ops.filter((o: any) => o.status === "ok").length;
				const total = t.ops.length;
				const pc = t.postcondition ? (t.postcondition.ok ? "pc✓" : "pc✗") : "pc-";
				console.log(`   ${okCount === total ? "✓" : "✗"} ${t.name} ${okCount}/${total} ops ${pc}`);
				if (okCount !== total) {
					for (const o of t.ops) {
						if (o.status !== "ok") console.log(`      ${o.op}:${o.target.role}:${o.target.name} — ${o.status}${o.error ? ` (${o.error.slice(0, 80)})` : ""}`);
					}
				}
			}
			if (r.nav_error) console.log(`   ✗ nav_error: ${r.nav_error}`);
		} catch (e: any) {
			console.log(`   ✗ runSpec threw: ${e?.message ?? e}`);
			reports.push({ slug: entry.slug, url: entry.url, error: String(e?.message ?? e) });
		}
	}
	await browser.close();

	// Tabulate
	const verbStats: Record<string, { total: number; ok: number }> = {};
	const pcStats: Record<string, { total: number; ok: number }> = {};
	for (const rep of reports) {
		for (const tool of rep.tools ?? []) {
			if (tool.hitl_gated) continue;
			for (const op of tool.ops) {
				verbStats[op.op] ??= { total: 0, ok: 0 };
				verbStats[op.op].total++;
				if (op.status === "ok") verbStats[op.op].ok++;
			}
			if (tool.postcondition) {
				pcStats[tool.postcondition.kind] ??= { total: 0, ok: 0 };
				pcStats[tool.postcondition.kind].total++;
				if (tool.postcondition.ok) pcStats[tool.postcondition.kind].ok++;
			}
		}
	}
	const specsExecuted = reports.filter(r => r.tools && r.tools.length);
	const specsAllOps = specsExecuted.filter(r => {
		return r.tools.every((t: any) => t.hitl_gated || t.ops.every((o: any) => o.status === "ok"));
	}).length;

	const summary = {
		ran_at: new Date().toISOString(),
		n_specs: SPECS.length,
		specs_with_nav_error: reports.filter(r => r.nav_error).length,
		specs_all_ops_passed: specsAllOps,
		pct_specs_all_ops_passed: `${specsAllOps}/${SPECS.length}`,
		per_verb: Object.fromEntries(Object.entries(verbStats).map(([v, s]) => [v, `${s.ok}/${s.total} (${Math.round(100*s.ok/s.total)}%)`])),
		per_postcondition: Object.fromEntries(Object.entries(pcStats).map(([k, s]) => [k, `${s.ok}/${s.total}`])),
	};
	await writeFile(`${OUT}/results.json`, JSON.stringify(reports, null, 2));
	await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
	console.log(`\n=== SUMMARY ===\n${JSON.stringify(summary, null, 2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
