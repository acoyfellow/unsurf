/**
 * Plan — the unified executor for proof-spec.v0.json.
 *
 * Takes a ProofSpec + args; dispatches observe/act/assert; returns an EvidenceBundle.
 *
 * Capabilities are auto-detected at runtime:
 *   - "dom"  — requires Chrome CDP on port 9222 (or CDP_PORT env)
 *   - "http" — always available (Bun fetch)
 *   - "exec" — disabled by default; enable with ENABLE_EXEC=1 (server-side only)
 *
 * This is the artifact that makes the unsurf+gateproof merge executable, not
 * just typechecked. Same executor handles:
 *   - tool-only specs (act only)                  → invoke()
 *   - gate-only specs (observe + assert, no act)  → verify()
 *   - full loops (observe + act + assert + loop)  → runLoop()
 *
 * Pure Bun — no deps except built-in WebSocket + fetch.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
	ActionResult,
	AssertionResult,
	DslOp,
	Assertion,
	Observation,
	ObservationResult,
	EvidenceBundle,
	ProofSpec,
	Status,
} from "./types";
import { computeRisk } from "./types";

// ==================== CDP client (minimal, reused from daemon) ====================

interface CDPClient {
	sessionId: string;
	send<T = unknown>(method: string, params?: object): Promise<T>;
}

async function connectToTab(url: string): Promise<CDPClient> {
	const cdpPort = process.env.CDP_PORT ?? "9222";
	const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json()) as any[];
	const target = list.find(
		(t) =>
			t.type === "page" &&
			(t.url === url || t.url.startsWith(url) || url.startsWith(t.url.split("?")[0].split("#")[0])),
	);
	if (!target) throw new Error(`no CDP target matches url: ${url}`);
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((res, rej) => {
		ws.addEventListener("open", () => res(), { once: true });
		ws.addEventListener("error", (e) => rej(new Error(String(e))), { once: true });
	});
	let id = 0;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	ws.addEventListener("message", (ev) => {
		const m = JSON.parse(String(ev.data));
		if (m.id && pending.has(m.id)) {
			const p = pending.get(m.id)!;
			pending.delete(m.id);
			if (m.error) p.reject(new Error(m.error.message));
			else p.resolve(m.result);
		}
	});
	return {
		sessionId: "",
		send: <T>(method: string, params: object = {}): Promise<T> =>
			new Promise((res, rej) => {
				const i = ++id;
				pending.set(i, { resolve: res as (v: unknown) => void, reject: rej });
				ws.send(JSON.stringify({ id: i, method, params }));
			}),
	};
}

async function navigateAndWait(cdp: CDPClient, url: string) {
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Page.navigate", { url });
	await new Promise((r) => setTimeout(r, 3000)); // settle
}

/** Evaluate JS in the tab; return the typed value. */
async function evalInTab<T = unknown>(cdp: CDPClient, expr: string): Promise<T> {
	const r = (await cdp.send("Runtime.evaluate", {
		expression: expr,
		returnByValue: true,
		awaitPromise: true,
	})) as { result: { value?: T } };
	return r.result.value as T;
}

// ==================== Placeholder substitution ====================

function substitute(template: unknown, args: Record<string, unknown>): unknown {
	if (typeof template !== "string") return template;
	return template.replace(/\{\{(\w+)\}\}/g, (_m, k) =>
		args[k] !== undefined ? String(args[k]) : `{{${k}}}`,
	);
}

// ==================== DOM runner (in-page JS via CDP Runtime.evaluate) ====================

const DOM_HELPERS = `
const ROLE_SELECTORS = {
	button: "button, [role=button], input[type=submit], input[type=button]",
	textbox: 'input[type=text], input[type=email], input[type=tel], input[type=url], input[type=password], input:not([type]), textarea, [role=textbox]',
	searchbox: 'input[type=search], [role=searchbox]',
	combobox: "select, [role=combobox]",
	checkbox: 'input[type=checkbox], [role=checkbox]',
	radio: 'input[type=radio], [role=radio]',
	link: "a[href], [role=link]",
	heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
	img: "img, [role=img]",
	list: "ul, ol, [role=list]",
	listitem: "li, [role=listitem]",
	form: "form, [role=form]",
	navigation: "nav, [role=navigation]",
	dialog: "dialog, [role=dialog]",
	tab: "[role=tab]",
	tabpanel: "[role=tabpanel]",
	region: "[role=region]",
	status: "[role=status]",
	table: "table, [role=table]",
	cell: "td, th, [role=cell]",
	option: "option, [role=option]",
	menu: "[role=menu]",
	menuitem: "[role=menuitem]",
	switch: "[role=switch]",
	tooltip: "[role=tooltip]",
};
function accessibleName(el) {
	const al = el.getAttribute?.("aria-label");
	if (al) return al.trim();
	const lb = el.getAttribute?.("aria-labelledby");
	if (lb) { const l = document.getElementById(lb); if (l) return (l.textContent ?? "").trim(); }
	const tag = el.tagName?.toUpperCase();
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
		if (el.id) { const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (lab) return (lab.textContent ?? "").trim(); }
		const lbl = el.closest?.("label"); if (lbl) return (lbl.textContent ?? "").trim();
		const ph = el.getAttribute?.("placeholder"); if (ph) return ph.trim();
		const n = el.getAttribute?.("name"); if (n) return n.trim();
	}
	return (el.textContent ?? "").trim();
}
function byRoleAndName(role, name, nth) {
	const sel = ROLE_SELECTORS[role];
	if (!sel) return null;
	const all = Array.from(document.querySelectorAll(sel));
	if (!all.length) return null;
	const lower = name.toLowerCase();
	let m = all.filter(el => accessibleName(el).trim().toLowerCase() === lower);
	if (m[nth]) return m[nth];
	m = all.filter(el => accessibleName(el).toLowerCase().includes(lower));
	return m[nth] ?? null;
}
`;

async function runDomObservation(cdp: CDPClient, obs: Observation & { kind: "dom" }): Promise<ObservationResult> {
	const t0 = Date.now();
	const expr = `
		(function() {
			${DOM_HELPERS}
			const t = ${JSON.stringify(obs.target)};
			const el = byRoleAndName(t.role, t.name, t.nth ?? 0);
			if (!el) return { ok: false, detail: "element not found: " + t.role + ':"' + t.name + '"' };
			const as = ${JSON.stringify(obs.as ?? "exists")};
			if (as === "exists") return { ok: true, detail: "found" };
			if (as === "text") return { ok: true, detail: (el.innerText ?? el.textContent ?? "").slice(0, 200) };
			if (as === "value") return { ok: true, detail: String(el.value ?? "").slice(0, 200) };
			return { ok: false, detail: "unknown as: " + as };
		})()
	`;
	try {
		const result = await evalInTab<{ ok: boolean; detail: string }>(cdp, expr);
		return { kind: "dom", ok: result.ok, detail: result.detail, durationMs: Date.now() - t0 };
	} catch (e) {
		return { kind: "dom", ok: false, detail: String((e as Error).message), durationMs: Date.now() - t0 };
	}
}

async function runDomAct(cdp: CDPClient, op: DslOp, args: Record<string, unknown>): Promise<ActionResult> {
	if (op.op === "exec") {
		return { op: "exec", ok: false, error: "exec is not a DOM op", durationMs: 0 };
	}
	const t0 = Date.now();
	const opWithSubst = { ...op };
	// Substitute {{arg}} in value fields
	if ("value" in op && typeof op.value === "string") {
		(opWithSubst as any).value = substitute(op.value, args);
	}
	const expr = `
		(function() {
			${DOM_HELPERS}
			try {
				const op = ${JSON.stringify(opWithSubst)};
				const el = byRoleAndName(op.target.role, op.target.name, op.target.nth ?? 0);
				if (!el) return { ok: false, error: "target not found: " + op.target.role + ':"' + op.target.name + '"' };

				if (op.op === "click") { el.click(); return { ok: true }; }
				if (op.op === "fill") {
					const desc = Object.getOwnPropertyDescriptor(
						el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
						"value"
					);
					if (desc?.set) desc.set.call(el, op.value); else el.value = op.value;
					el.dispatchEvent(new Event("input", { bubbles: true }));
					el.dispatchEvent(new Event("change", { bubbles: true }));
					return { ok: true };
				}
				if (op.op === "select") {
					el.value = op.value;
					el.dispatchEvent(new Event("change", { bubbles: true }));
					return { ok: true };
				}
				if (op.op === "check") {
					if (op.value && !el.checked) el.click();
					else if (!op.value && el.checked) el.click();
					return { ok: true };
				}
				if (op.op === "submit") {
					const form = el.closest?.("form") || (el.tagName === "FORM" ? el : null);
					if (!form) return { ok: false, error: "submit: no form context" };
					if (form.requestSubmit) form.requestSubmit(); else form.submit();
					return { ok: true };
				}
				if (op.op === "read") {
					const as = op.as ?? "text";
					let v = "";
					if (as === "text") v = el.innerText ?? el.textContent ?? "";
					else if (as === "value") v = String(el.value ?? "");
					else if (as === "attr") v = el.getAttribute?.(op.attr) ?? "";
					return { ok: true, readValue: String(v).slice(0, 500) };
				}
				return { ok: false, error: "unknown op: " + op.op };
			} catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
		})()
	`;
	try {
		const result = await evalInTab<{ ok: boolean; error?: string; readValue?: string }>(cdp, expr);
		return {
			op: op.op,
			ok: result.ok,
			error: result.error,
			readValue: result.readValue,
			durationMs: Date.now() - t0,
		};
	} catch (e) {
		return { op: op.op, ok: false, error: String((e as Error).message), durationMs: Date.now() - t0 };
	}
}

// ==================== HTTP runner ====================

async function runHttpObservation(obs: Observation & { kind: "http" }): Promise<ObservationResult> {
	const t0 = Date.now();
	try {
		const r = await fetch(obs.url, { signal: AbortSignal.timeout(10000) });
		const body = await r.text();
		let ok = r.ok;
		let detail = `status=${r.status}`;
		if (obs.expect?.status && r.status !== obs.expect.status) {
			ok = false;
			detail = `expected status ${obs.expect.status}, got ${r.status}`;
		}
		if (obs.expect?.bodyIncludes && !body.includes(obs.expect.bodyIncludes)) {
			ok = false;
			detail = `expected body to include "${obs.expect.bodyIncludes.slice(0, 40)}…"`;
		}
		return { kind: "http", ok, detail, durationMs: Date.now() - t0 };
	} catch (e) {
		return {
			kind: "http",
			ok: false,
			detail: String((e as Error).message),
			durationMs: Date.now() - t0,
		};
	}
}

// ==================== Assertions ====================

async function runAssertion(
	cdp: CDPClient | null,
	assertion: Assertion,
	_evidence: { actions: ActionResult[]; errors: string[] },
	args: Record<string, unknown>,
): Promise<AssertionResult> {
	if (assertion.kind === "textPresent") {
		if (!cdp) return { kind: "textPresent", ok: false, detail: "no CDP session" };
		const needle = substitute(assertion.value, args) as string;
		const r = await evalInTab<{ ok: boolean; detail: string }>(cdp, `
			(function() {
				const body = document.body?.innerText ?? "";
				const found = body.toLowerCase().includes(${JSON.stringify(needle.toLowerCase())});
				return { ok: found, detail: found ? "found" : "not in visible body" };
			})()
		`);
		return { kind: "textPresent", ok: r.ok, detail: r.detail };
	}
	if (assertion.kind === "urlMatches") {
		if (!cdp) return { kind: "urlMatches", ok: false, detail: "no CDP session" };
		const url = await evalInTab<string>(cdp, "location.href");
		const re = new RegExp(assertion.pattern);
		return { kind: "urlMatches", ok: re.test(url), detail: `url=${url}` };
	}
	if (assertion.kind === "elementExists") {
		if (!cdp) return { kind: "elementExists", ok: false, detail: "no CDP session" };
		const r = await evalInTab<boolean>(cdp, `
			(function() {
				${DOM_HELPERS}
				const t = ${JSON.stringify(assertion.target)};
				return !!byRoleAndName(t.role, t.name, t.nth ?? 0);
			})()
		`);
		return { kind: "elementExists", ok: !!r, detail: r ? "found" : "not found" };
	}
	if (assertion.kind === "httpResponse") {
		const url = assertion.url;
		if (!url) return { kind: "httpResponse", ok: false, detail: "no url" };
		const t0 = Date.now();
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
			const dur = Date.now() - t0;
			let ok = true;
			const parts: string[] = [`status=${r.status}`, `dur=${dur}ms`];
			if (assertion.status && r.status !== assertion.status) ok = false;
			if (assertion.durationUnder && dur > assertion.durationUnder) ok = false;
			return { kind: "httpResponse", ok, detail: parts.join(" ") };
		} catch (e) {
			return { kind: "httpResponse", ok: false, detail: String((e as Error).message) };
		}
	}
	if (assertion.kind === "responseBodyIncludes") {
		// simple: fetch the top-level URL and look for the substring
		if (!cdp) return { kind: "responseBodyIncludes", ok: false, detail: "needs http context" };
		const url = await evalInTab<string>(cdp, "location.href");
		try {
			const r = await fetch(url);
			const body = await r.text();
			const ok = body.includes(assertion.value);
			return { kind: "responseBodyIncludes", ok, detail: ok ? "included" : "not found" };
		} catch (e) {
			return { kind: "responseBodyIncludes", ok: false, detail: String((e as Error).message) };
		}
	}
	if (assertion.kind === "noErrors") {
		const errs = _evidence.errors ?? [];
		const actErrs = _evidence.actions.filter((a) => !a.ok).length;
		const ok = errs.length === 0 && actErrs === 0;
		return { kind: "noErrors", ok, detail: `errors=${errs.length} failedActs=${actErrs}` };
	}
	if (assertion.kind === "hasAction") {
		// For now: check if any action result mentions the id in readValue — weak; gateproof does more.
		const ok = _evidence.actions.some((a) => a.readValue?.includes(assertion.id));
		return { kind: "hasAction", ok, detail: `looking for id=${assertion.id}` };
	}
	if (assertion.kind === "numericDeltaFromEnv") {
		const before = Number(process.env[assertion.key]);
		if (Number.isNaN(before)) {
			return { kind: "numericDeltaFromEnv", ok: false, detail: `env ${assertion.key} not a number` };
		}
		// No "after" source yet — weakest implementation; gateproof has more context
		return {
			kind: "numericDeltaFromEnv",
			ok: false,
			detail: `v0: numericDeltaFromEnv requires a post-action env probe not implemented yet`,
		};
	}
	return { kind: (assertion as Assertion).kind, ok: false, detail: "unhandled assertion kind" };
}

// ==================== The Plan (executor) ====================

export interface PlanRunOptions {
	/** If set, fetch this URL first (via CDP if DOM ops are present, else skip). */
	preNavigate?: boolean;
}

export async function run(
	spec: ProofSpec,
	args: Record<string, unknown> = {},
	opts: PlanRunOptions = {},
): Promise<EvidenceBundle> {
	// Bypass risk label claim — compute fresh
	const computedRisk = computeRisk(spec.act);

	const observations: ObservationResult[] = [];
	const actions: ActionResult[] = [];
	const assertions: AssertionResult[] = [];
	const errors: string[] = [];
	const content: { type: "text"; text: string }[] = [];

	const needsDom =
		(spec.observe?.some((o) => o.kind === "dom") ?? false) ||
		(spec.act?.some((o) => o.op !== "exec") ?? false) ||
		(spec.assert?.some((a) =>
			["textPresent", "urlMatches", "elementExists", "responseBodyIncludes"].includes(a.kind),
		) ?? false);

	let cdp: CDPClient | null = null;
	if (needsDom && spec.target?.url) {
		try {
			cdp = await connectToTab(spec.target.url);
			if (opts.preNavigate) await navigateAndWait(cdp, spec.target.url);
		} catch (e) {
			errors.push(`cdp-connect: ${(e as Error).message}`);
		}
	}

	const loopMax = computedRisk === "high" ? 1 : spec.loop?.maxIterations ?? 1;
	let iterations = 0;
	let finalStatus: Status = "inconclusive";

	for (let i = 0; i < loopMax; i++) {
		iterations++;

		// OBSERVE
		for (const obs of spec.observe ?? []) {
			if (obs.kind === "dom") {
				if (!cdp) observations.push({ kind: "dom", ok: false, detail: "no cdp", durationMs: 0 });
				else observations.push(await runDomObservation(cdp, obs));
			} else if (obs.kind === "http") {
				observations.push(await runHttpObservation(obs));
			} else if (obs.kind === "exec") {
				observations.push({
					kind: "exec",
					ok: false,
					detail: "exec observations not supported in v0 client runner",
					durationMs: 0,
				});
			} else if (obs.kind === "note") {
				observations.push({ kind: "note", ok: false, detail: "note not implemented", durationMs: 0 });
			}
		}

		// ACT
		for (const op of spec.act ?? []) {
			if (op.op === "exec") {
				actions.push({ op: "exec", ok: false, error: "exec disabled in client runner", durationMs: 0 });
				errors.push(`exec not supported in client runner`);
				continue;
			}
			if (!cdp) {
				actions.push({ op: op.op, ok: false, error: "no cdp session", durationMs: 0 });
				continue;
			}
			const ar = await runDomAct(cdp, op, args);
			actions.push(ar);
			if (ar.readValue) content.push({ type: "text", text: ar.readValue });
			if (!ar.ok) {
				errors.push(`${op.op} ${(op as any).target?.name ?? ""}: ${ar.error}`);
			}
		}

		// Pause a bit for the page to settle before assertions (esp. after navigation)
		if (spec.act?.length && cdp) {
			await new Promise((r) => setTimeout(r, 1000));
		}

		// ASSERT
		assertions.length = 0;
		for (const a of spec.assert ?? []) {
			assertions.push(
				await runAssertion(cdp, a, { actions: [...actions], errors: [...errors] }, args),
			);
		}

		const allAssertionsPass =
			assertions.length > 0 ? assertions.every((a) => a.ok) : errors.length === 0;

		if (allAssertionsPass) {
			finalStatus = "pass";
			break;
		}
		if (spec.loop?.stopOnFailure !== false && i === loopMax - 1) {
			finalStatus = "fail";
			break;
		}
	}

	if (finalStatus === "inconclusive") {
		// No assertions declared, no errors — treat as pass
		finalStatus = errors.length === 0 ? "pass" : "fail";
	}

	return {
		status: finalStatus,
		iterations,
		observations,
		actions,
		assertions,
		content: content.length ? content : undefined,
		errors,
	};
}

// ==================== Convenience wrappers ====================

export const Plan = {
	/** Run act — unsurf-style tool invocation. Runs observe+assert too if present. */
	async invoke(spec: ProofSpec, args: Record<string, unknown> = {}): Promise<EvidenceBundle> {
		return run(spec, args);
	},
	/** Run observe + assert only — gateproof-style gate verification. */
	async verify(spec: ProofSpec, args: Record<string, unknown> = {}): Promise<EvidenceBundle> {
		// Strip act[] by shallow-cloning the spec
		return run({ ...spec, act: [] }, args);
	},
	/** Full loop. Honors spec.loop. */
	async runLoop(spec: ProofSpec, args: Record<string, unknown> = {}): Promise<EvidenceBundle> {
		return run(spec, args);
	},
	/** Auto-pick based on spec shape. */
	async auto(spec: ProofSpec, args: Record<string, unknown> = {}): Promise<EvidenceBundle> {
		const hasAct = (spec.act?.length ?? 0) > 0;
		const hasObserveOrAssert = (spec.observe?.length ?? 0) + (spec.assert?.length ?? 0) > 0;
		if (hasAct && hasObserveOrAssert) return run(spec, args);
		if (hasAct) return run(spec, args);
		if (hasObserveOrAssert) return run({ ...spec, act: [] }, args);
		throw new Error("spec has no act, observe, or assert");
	},
};

// ==================== CLI entry ====================

if (import.meta.main) {
	const specPath = process.argv[2];
	if (!specPath) {
		console.error("usage: bun run plan.ts <spec.json> [args.json]");
		process.exit(1);
	}
	const spec = JSON.parse(readFileSync(resolve(specPath), "utf8")) as ProofSpec;
	const args = process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]), "utf8")) : {};
	const result = await Plan.auto(spec, args);
	console.log(JSON.stringify(result, null, 2));
	process.exit(result.status === "pass" ? 0 : 1);
}
