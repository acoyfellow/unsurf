/**
 * Plan — the unified executor for proof-spec.v0.json.
 *
 * Takes a ProofSpec + args; dispatches observe/act/assert; returns an
 * EvidenceBundle. One spec shape, three usage modes:
 *
 *   Plan.invoke(spec, args)  — unsurf-style tool invocation (runs act[])
 *   Plan.verify(spec, args)  — gateproof-style gate verification (observe + assert)
 *   Plan.runLoop(spec, args) — full loop, honors spec.loop.maxIterations
 *   Plan.auto(spec, args)    — picks based on spec shape
 *
 * Capabilities dispatched at runtime:
 *   - "dom"  — requires Chrome CDP on port 9222 (or CDP_PORT env)
 *   - "http" — always available (built-in fetch)
 *   - "exec" — server-only, currently rejected in the client runner
 *
 * Risk labeling is deterministic — the synthesizer's claimed `risk` is ignored;
 * computeRisk() in domain/ProofSpec.ts computes it fresh from act[].
 * `risk: "high"` specs are forced to loop.maxIterations = 1 (no destructive retries).
 *
 * Origin: experiments/_proof-spec-v0/plan.ts. Graduated unchanged in logic; wrapped
 * in an Effect service surface to match sibling services (SchemaInferrer etc.).
 */

import { Context, Effect, Layer } from "effect";
import { SCORERS } from "../domain/JudgeScorers.js";
import type {
	ActionResult,
	Assertion,
	AssertionResult,
	DslOp,
	EvidenceBundle,
	Observation,
	ObservationResult,
	ProofSpec,
	Status,
} from "../domain/ProofSpec.js";
import { computeRisk } from "../domain/ProofSpec.js";

// ==================== CDP client (minimal) ====================

interface CDPClient {
	send<T = unknown>(method: string, params?: object): Promise<T>;
	close(): void;
}

async function connectToTab(url: string, cdpPort: string): Promise<CDPClient> {
	const listResp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
	const list = (await listResp.json()) as Array<{
		type: string;
		url: string;
		webSocketDebuggerUrl: string;
	}>;
	const target = list.find(
		(t) =>
			t.type === "page" &&
			(t.url === url ||
				t.url.startsWith(url) ||
				url.startsWith(t.url.split("?")[0]?.split("#")[0] ?? "")),
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
		const m = JSON.parse(String(ev.data)) as {
			id?: number;
			result?: unknown;
			error?: { message?: string };
		};
		if (m.id !== undefined && pending.has(m.id)) {
			const p = pending.get(m.id)!;
			pending.delete(m.id);
			if (m.error) p.reject(new Error(m.error.message ?? "CDP error"));
			else p.resolve(m.result);
		}
	});

	return {
		send: <T>(method: string, params: object = {}): Promise<T> =>
			new Promise((res, rej) => {
				const i = ++id;
				pending.set(i, { resolve: res as (v: unknown) => void, reject: rej });
				ws.send(JSON.stringify({ id: i, method, params }));
			}),
		close: () => ws.close(),
	};
}

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

// ==================== DOM helpers (inlined for CDP Runtime.evaluate) ====================

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

// ==================== DOM observe/act ====================

async function runDomObservation(
	cdp: CDPClient,
	obs: Extract<Observation, { kind: "dom" }>,
): Promise<ObservationResult> {
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
		const r = await evalInTab<{ ok: boolean; detail: string }>(cdp, expr);
		return { kind: "dom", ok: r.ok, detail: r.detail, durationMs: Date.now() - t0 };
	} catch (e) {
		return {
			kind: "dom",
			ok: false,
			detail: String((e as Error).message),
			durationMs: Date.now() - t0,
		};
	}
}

async function runDomAct(
	cdp: CDPClient,
	op: DslOp,
	args: Record<string, unknown>,
): Promise<ActionResult> {
	if (op.op === "exec") {
		return {
			op: "exec",
			ok: false,
			error: "exec disabled in client runner",
			durationMs: 0,
		};
	}
	const t0 = Date.now();
	const opWithSubst: DslOp = { ...op };
	if ("value" in op && typeof op.value === "string") {
		(opWithSubst as { value?: unknown }).value = substitute(op.value, args);
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
		const r = await evalInTab<{ ok: boolean; error?: string; readValue?: string }>(cdp, expr);
		return {
			op: op.op,
			ok: r.ok,
			error: r.error,
			readValue: r.readValue,
			durationMs: Date.now() - t0,
		};
	} catch (e) {
		return {
			op: op.op,
			ok: false,
			error: String((e as Error).message),
			durationMs: Date.now() - t0,
		};
	}
}

// ==================== HTTP observe ====================

async function runHttpObservation(
	obs: Extract<Observation, { kind: "http" }>,
): Promise<ObservationResult> {
	const t0 = Date.now();
	try {
		const r = await fetch(obs.url, { signal: AbortSignal.timeout(10000) });
		const body = await r.text();
		let ok = r.ok;
		let detail = `status=${r.status}`;
		if (obs.expect?.status !== undefined && r.status !== obs.expect.status) {
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

// ==================== LLM-as-judge (cloudeval bridge) ====================

const JUDGE_CHOICES: Record<string, number> = { A: 1, B: 0.5, C: 0 };
const DEFAULT_JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * buildPrompt — copied verbatim from acoyfellow/cloudeval
 * src/scorers/workers-ai-judge.mjs. Kept in sync by hand.
 */
function buildPrompt({
	input,
	expected,
	output,
	rubric,
}: {
	input: string;
	expected: string;
	output: string;
	rubric: string;
}): string {
	return `${rubric}\n\nUser asked: ${input}\nExpected behavior: ${expected}\nAgent response: ${output}\n\nAnswer with a single letter A, B, or C.`;
}

function parseChoice(text: string): string | null {
	const match = text.match(/\b([ABC])\b/);
	return match?.[1] ?? null;
}

function extractJudgeOutput(evidence: {
	actions: readonly ActionResult[];
	content: readonly { type: "text"; text: string }[];
}): string {
	const lastContent = evidence.content[evidence.content.length - 1];
	if (lastContent?.text) return lastContent.text;
	const reads = evidence.actions
		.map((a) => a.readValue)
		.filter((v): v is string => typeof v === "string" && v.length > 0);
	return reads.join("\n");
}

function extractJudgeInput(args: Record<string, unknown>): string {
	if (typeof args.input === "string") return args.input;
	if (typeof args.query === "string") return args.query;
	for (const v of Object.values(args)) {
		if (typeof v === "string") return v;
	}
	return "";
}

async function callWorkersAiJudge(
	endpoint: string,
	model: string,
	prompt: string,
): Promise<string> {
	const res = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: prompt }],
			max_tokens: 32,
		}),
		signal: AbortSignal.timeout(15000),
	});
	if (!res.ok) throw new Error(`judge http ${res.status}`);
	const data = (await res.json()) as {
		response?: string;
		result?: { response?: string };
	};
	return data.response ?? data.result?.response ?? "";
}

async function runJudgeScoreAssertion(
	assertion: Extract<Assertion, { kind: "judgeScore" }>,
	evidence: {
		actions: readonly ActionResult[];
		content: readonly { type: "text"; text: string }[];
	},
	args: Record<string, unknown>,
): Promise<AssertionResult> {
	const threshold = assertion.threshold ?? 1;
	const judgeModel = assertion.judgeModel ?? DEFAULT_JUDGE_MODEL;
	const endpoint = process.env.WORKERS_AI_ENDPOINT ?? "http://127.0.0.1:8890/run";
	const explicitlyConfigured = !!process.env.WORKERS_AI_ENDPOINT;

	const rubric = (SCORERS as Record<string, string>)[assertion.scorer];
	if (!rubric) {
		return {
			kind: "judgeScore",
			ok: false,
			detail: `scorer=${assertion.scorer} unknown scorer (not in SCORERS)`,
		};
	}

	const output = extractJudgeOutput(evidence);
	const input = extractJudgeInput(args);
	const expected = assertion.expected ?? "";
	const prompt = buildPrompt({ input, expected, output, rubric });

	let raw: string;
	try {
		raw = await callWorkersAiJudge(endpoint, judgeModel, prompt);
	} catch (e) {
		if (!explicitlyConfigured) {
			return {
				kind: "judgeScore",
				ok: false,
				detail: "no judge endpoint configured (WORKERS_AI_ENDPOINT)",
			};
		}
		return {
			kind: "judgeScore",
			ok: false,
			detail: `scorer=${assertion.scorer} judge call failed: ${(e as Error).message}`,
		};
	}

	const choice = parseChoice(raw);
	if (!choice) {
		return {
			kind: "judgeScore",
			ok: false,
			detail: `scorer=${assertion.scorer} score=0.5 choice=? unrecognized`,
		};
	}
	const score = JUDGE_CHOICES[choice] ?? 0;
	return {
		kind: "judgeScore",
		ok: score >= threshold,
		detail: `scorer=${assertion.scorer} score=${score} choice=${choice}`,
	};
}

// ==================== Assertions ====================

async function runAssertion(
	cdp: CDPClient | null,
	assertion: Assertion,
	evidence: {
		actions: readonly ActionResult[];
		errors: readonly string[];
		content: readonly { type: "text"; text: string }[];
	},
	args: Record<string, unknown>,
): Promise<AssertionResult> {
	if (assertion.kind === "textPresent") {
		if (!cdp) return { kind: "textPresent", ok: false, detail: "no CDP session" };
		const needle = substitute(assertion.value, args) as string;
		const r = await evalInTab<{ ok: boolean; detail: string }>(
			cdp,
			`
			(function() {
				const body = document.body?.innerText ?? "";
				const found = body.toLowerCase().includes(${JSON.stringify(needle.toLowerCase())});
				return { ok: found, detail: found ? "found" : "not in visible body" };
			})()
		`,
		);
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
		const r = await evalInTab<boolean>(
			cdp,
			`
			(function() {
				${DOM_HELPERS}
				const t = ${JSON.stringify(assertion.target)};
				return !!byRoleAndName(t.role, t.name, t.nth ?? 0);
			})()
		`,
		);
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
			if (assertion.status !== undefined && r.status !== assertion.status) ok = false;
			if (assertion.durationUnder !== undefined && dur > assertion.durationUnder) ok = false;
			return { kind: "httpResponse", ok, detail: `status=${r.status} dur=${dur}ms` };
		} catch (e) {
			return { kind: "httpResponse", ok: false, detail: String((e as Error).message) };
		}
	}
	if (assertion.kind === "responseBodyIncludes") {
		if (!cdp) return { kind: "responseBodyIncludes", ok: false, detail: "needs page context" };
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
		const errsLen = evidence.errors.length;
		const actErrs = evidence.actions.filter((a) => !a.ok).length;
		const ok = errsLen === 0 && actErrs === 0;
		return { kind: "noErrors", ok, detail: `errors=${errsLen} failedActs=${actErrs}` };
	}
	if (assertion.kind === "hasAction") {
		const ok = evidence.actions.some((a) => a.readValue?.includes(assertion.id));
		return { kind: "hasAction", ok, detail: `looking for id=${assertion.id}` };
	}
	if (assertion.kind === "numericDeltaFromEnv") {
		return {
			kind: "numericDeltaFromEnv",
			ok: false,
			detail: "v0: numericDeltaFromEnv requires post-action env probe (not yet)",
		};
	}
	if (assertion.kind === "judgeScore") {
		return runJudgeScoreAssertion(assertion, evidence, args);
	}
	return {
		kind: (assertion as Assertion).kind,
		ok: false,
		detail: "unhandled assertion kind",
	};
}

// ==================== Core runner (Promise-based, pure async) ====================

export interface PlanRunOptions {
	/** If set, navigate the tab to spec.target.url before running (default false — assumes the tab is already there). */
	preNavigate?: boolean;
	/** CDP port override. Default 9222 or CDP_PORT env. */
	cdpPort?: string;
}

async function runCore(
	spec: ProofSpec,
	args: Record<string, unknown> = {},
	opts: PlanRunOptions = {},
): Promise<EvidenceBundle> {
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
		) ??
			false);

	let cdp: CDPClient | null = null;
	if (needsDom && spec.target?.url) {
		try {
			const cdpPort = opts.cdpPort ?? process.env.CDP_PORT ?? "9222";
			cdp = await connectToTab(spec.target.url, cdpPort);
			if (opts.preNavigate) {
				await cdp.send("Page.enable");
				await cdp.send("Page.navigate", { url: spec.target.url });
				await new Promise((r) => setTimeout(r, 3000));
			}
		} catch (e) {
			errors.push(`cdp-connect: ${(e as Error).message}`);
		}
	}

	const loopMax = computedRisk === "high" ? 1 : (spec.loop?.maxIterations ?? 1);
	let iterations = 0;
	let finalStatus: Status = "inconclusive";

	try {
		for (let i = 0; i < loopMax; i++) {
			iterations++;

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
						detail: "exec disabled in client runner",
						durationMs: 0,
					});
				} else if (obs.kind === "note") {
					observations.push({
						kind: "note",
						ok: false,
						detail: "note not implemented",
						durationMs: 0,
					});
				}
			}

			for (const op of spec.act ?? []) {
				if (op.op === "exec") {
					actions.push({
						op: "exec",
						ok: false,
						error: "exec disabled in client runner",
						durationMs: 0,
					});
					errors.push("exec not supported");
					continue;
				}
				if (!cdp) {
					actions.push({ op: op.op, ok: false, error: "no cdp session", durationMs: 0 });
					continue;
				}
				const ar = await runDomAct(cdp, op, args);
				actions.push(ar);
				if (ar.readValue) content.push({ type: "text", text: ar.readValue });
				if (!ar.ok) errors.push(`${op.op}: ${ar.error}`);
			}

			if ((spec.act?.length ?? 0) > 0 && cdp) {
				await new Promise((r) => setTimeout(r, 1000));
			}

			assertions.length = 0;
			for (const a of spec.assert ?? []) {
				assertions.push(await runAssertion(cdp, a, { actions, errors, content }, args));
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
	} finally {
		cdp?.close();
	}

	if (finalStatus === "inconclusive") {
		finalStatus = errors.length === 0 ? "pass" : "fail";
	}

	return {
		status: finalStatus,
		iterations,
		observations,
		actions,
		assertions,
		content: content.length > 0 ? content : undefined,
		errors,
	};
}

// ==================== Public API (sync functions) ====================

/**
 * Run any proof-spec shape. Auto-picks based on what the spec declares.
 * Use this as the default entry point.
 */
export function runSpec(
	spec: ProofSpec,
	args: Record<string, unknown> = {},
	opts: PlanRunOptions = {},
): Promise<EvidenceBundle> {
	return runCore(spec, args, opts);
}

/** unsurf-style: execute act[]. observe/assert run too if declared. */
export function invokeSpec(
	spec: ProofSpec,
	args: Record<string, unknown> = {},
	opts: PlanRunOptions = {},
): Promise<EvidenceBundle> {
	return runCore(spec, args, opts);
}

/** gateproof-style: run observe + assert only, ignore any act[]. */
export function verifySpec(
	spec: ProofSpec,
	args: Record<string, unknown> = {},
	opts: PlanRunOptions = {},
): Promise<EvidenceBundle> {
	return runCore({ ...spec, act: [] }, args, opts);
}

/** Full proof loop. Honors spec.loop.maxIterations (capped at 1 for risk:high). */
export function runLoopSpec(
	spec: ProofSpec,
	args: Record<string, unknown> = {},
	opts: PlanRunOptions = {},
): Promise<EvidenceBundle> {
	return runCore(spec, args, opts);
}

// ==================== Effect service surface ====================

export interface PlanService {
	readonly invoke: (
		spec: ProofSpec,
		args?: Record<string, unknown>,
		opts?: PlanRunOptions,
	) => Effect.Effect<EvidenceBundle>;
	readonly verify: (
		spec: ProofSpec,
		args?: Record<string, unknown>,
		opts?: PlanRunOptions,
	) => Effect.Effect<EvidenceBundle>;
	readonly runLoop: (
		spec: ProofSpec,
		args?: Record<string, unknown>,
		opts?: PlanRunOptions,
	) => Effect.Effect<EvidenceBundle>;
	readonly auto: (
		spec: ProofSpec,
		args?: Record<string, unknown>,
		opts?: PlanRunOptions,
	) => Effect.Effect<EvidenceBundle>;
}

export class Plan extends Context.Tag("Plan")<Plan, PlanService>() {}

export function makePlan(): PlanService {
	return {
		invoke: (spec, args = {}, opts = {}) => Effect.promise(() => invokeSpec(spec, args, opts)),
		verify: (spec, args = {}, opts = {}) => Effect.promise(() => verifySpec(spec, args, opts)),
		runLoop: (spec, args = {}, opts = {}) => Effect.promise(() => runLoopSpec(spec, args, opts)),
		auto: (spec, args = {}, opts = {}) => Effect.promise(() => runSpec(spec, args, opts)),
	};
}

export const PlanLive = Layer.succeed(Plan, makePlan());
