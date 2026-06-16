#!/usr/bin/env node

/**
 * unsurf CLI — query the unsurf directory and run proof-specs.
 *
 * Directory (against the hosted API):
 *   unsurf search <query>          Search the API directory
 *   unsurf lookup <domain>         Get fingerprint for a domain
 *   unsurf publish <siteId>        Publish a scouted site to the directory
 *
 * proof-spec.v0 (local, requires Chrome CDP on :9222 for DOM work):
 *   unsurf run <spec.json> [--args <json>] [--cdp-port <port>] [--pre-navigate]
 *                                  Execute a proof-spec; prints the EvidenceBundle
 *                                  as JSON to stdout. Exits 0 on pass, 1 otherwise.
 *   unsurf scout <url> [--out <file>] [--cdp-port <port>]
 *                                  Snapshot a page's interactive DOM via CDP and
 *                                  emit a skeleton proof-spec. Stub-only — no LLM
 *                                  synthesis yet. Falls back to an empty skeleton
 *                                  when CDP is unavailable.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { ProofSpec } from "./domain/ProofSpec.js";
import { runSpec } from "./services/Plan.js";

const API_BASE = "https://unsurf-api.coey.dev";

// ==================== Helpers ====================

async function api(path: string, options?: RequestInit): Promise<unknown> {
	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});

	if (!res.ok) {
		const body = await res.text();
		let message: string;
		try {
			message = (JSON.parse(body) as { error?: string }).error ?? body;
		} catch {
			message = body;
		}
		throw new Error(`API error (${res.status}): ${message}`);
	}

	return res.json();
}

function printJson(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

function usage(): never {
	console.log(`unsurf — Turn browser behavior into independently replayed proof

Usage:
  unsurf search <query>                    Search the API directory
  unsurf lookup <domain>                   Get fingerprint for a domain
  unsurf publish <siteId>                  Publish a scouted site to the directory

  unsurf run <spec.json> [flags]           Execute a proof-spec.v0 JSON
    --args <json>                          Inline args JSON (or pass via stdin)
    --cdp-port <port>                      CDP port (default 9222)
    --pre-navigate                         Navigate the tab to target.url first

  unsurf investigate [flags]               Discover a repro and confirm a fix
    --symptom <text>                       Vague browser symptom (required)
    --broken <url>                         Known-broken target (required)
    --fixed <url>                          Candidate/fixed target (optional)
    --runs <n>                             Confirmation runs (default 3)
    --out <dir>                            Evidence directory (.unsurf/runs/<id>)
    --selector <css>                       State element (default body)
    --attribute <name>                     State attribute (default data-state)
    --failure-value <value>                Unwanted value (default resumed)
    --success-value <value>                Expected fixed value (optional)

  unsurf replay <repro.json> [flags]        Replay a portable repro
    --target <url>                         Target URL (required)
    --runs <n>                             Replay count (default 3)
    --out <dir>                            Evidence directory

  unsurf doctor                            Check local browser/provider readiness

  unsurf scout <url> [flags]               Snapshot DOM; emit skeleton proof-spec
    --out <file>                           Write to file instead of stdout
    --cdp-port <port>                      CDP port (default 9222)

  unsurf record <script.(m)js|.ts> [flags] Record an agent run; prints trace URL
    --task <str>                           Human label (default: script path)
    --harness <str>                        Harness tag written to meta.json
    --cdp-port <port>                      Attach to an existing local browser
    --public                               Long-lived (365d) shareable grant.
                                           Default is private (7d grant).
                                           Both are grant-gated; no bare URLs.
    Env: TRACE_INGEST_TOKEN (required), TRACE_INGEST_ENDPOINT (optional)

  unsurf loop <goal|spec.json> [flags]     Record → observeVideo → refine loop
    --north-star <str>                     Yes/no question (required)
    --max-iter <n>                         Max iterations (default 5)
    --tick-ms <ms>                         Per-iteration budget (default 120000)
    --cdp-port <port>                      Attach recordings to an existing browser
    --public                               Record each iteration with a 365d
                                           shareable grant. Default is 7d.
    Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (Workers AI),
         TRACE_INGEST_TOKEN (trace upload)

  unsurf trace-token mint --owner <name> [flags]
                                           Mint a new ingest token (prints the token)
    --owner <str>                          Owner name stored in KV (required)
    --scope <str>                          Optional scope string
    --quota <n>                            Optional quota/day
    Env: TRACE_INGEST_TOKEN (root token, required)

  unsurf trace-token revoke <token>        Revoke a previously minted token
    Env: TRACE_INGEST_TOKEN (root token, required)

  unsurf trace-revoke <id>                 Revoke all viewer grants for a
                                           private trace (bumps generation,
                                           returns a fresh grant)
    Env: TRACE_INGEST_TOKEN (root token, required)

Examples:
  unsurf search "payment processing"
  unsurf lookup stripe.com
  unsurf run spec.json --args '{"q":"hello"}'
  unsurf scout https://coey.dev --out spec.json
  unsurf record ./demo-run.ts --task 'verify sidebar happy path'`);
	process.exit(0);
}

/** Parse flag value from argv. Returns undefined if not present. */
function flagValue(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	if (i === -1 || i === args.length - 1) return undefined;
	return args[i + 1];
}

/**
 * Validate a flag that requires a non-empty value. Distinguishes three cases
 * for the user instead of conflating them:
 *   - missing flag entirely
 *   - flag present with no following value (end of argv)
 *   - flag present with a value that looks like another flag
 */
function requireFlagValue(args: string[], name: string): string {
	const i = args.indexOf(name);
	if (i === -1) {
		console.error(`Error: missing required flag ${name}`);
		process.exit(1);
	}
	if (i === args.length - 1) {
		console.error(`Error: ${name} requires a value`);
		process.exit(1);
	}
	const val = args[i + 1] ?? "";
	if (!val || val.startsWith("--")) {
		console.error(`Error: ${name} requires a value (got ${val ? `"${val}"` : "empty"})`);
		process.exit(1);
	}
	return val;
}

function hasFlag(args: string[], name: string): boolean {
	return args.includes(name);
}

function readStdinSync(): string {
	try {
		// fd 0 = stdin. readFileSync throws EAGAIN if nothing piped — callers should
		// only reach here when stdin is non-TTY.
		return readFileSync(0, "utf8");
	} catch {
		return "";
	}
}

// ==================== Directory commands ====================

async function searchCommand(query: string): Promise<void> {
	const data = await api(`/search?q=${encodeURIComponent(query)}`);
	const results = (
		data as {
			results: Array<{
				domain: string;
				match: string;
				capability: string;
				confidence: number;
				specUrl: string;
			}>;
		}
	).results;

	if (!results || results.length === 0) {
		console.log("No results found.");
		return;
	}

	console.log(`Found ${results.length} result(s):\n`);
	for (const r of results) {
		console.log(`  ${r.domain}`);
		console.log(`    Match:      ${r.match}`);
		console.log(`    Capability: ${r.capability}`);
		console.log(`    Confidence: ${(r.confidence * 100).toFixed(1)}%`);
		console.log(`    Spec:       ${API_BASE}${r.specUrl}`);
		console.log();
	}
}

async function lookupCommand(domain: string): Promise<void> {
	const fp = (await api(`/d/${encodeURIComponent(domain)}`)) as {
		domain: string;
		url: string;
		endpoints: number;
		capabilities: string[];
		methods: Record<string, number>;
		auth: string;
		confidence: number;
		version: number;
		specUrl: string;
	};

	console.log(`Fingerprint for ${fp.domain}\n`);
	console.log(`  URL:          ${fp.url}`);
	console.log(`  Endpoints:    ${fp.endpoints}`);
	console.log(`  Capabilities: ${fp.capabilities.join(", ")}`);
	console.log(
		`  Methods:      ${Object.entries(fp.methods)
			.map(([m, c]) => `${m}:${c}`)
			.join(", ")}`,
	);
	console.log(`  Auth:         ${fp.auth}`);
	console.log(`  Confidence:   ${(fp.confidence * 100).toFixed(1)}%`);
	console.log(`  Version:      ${fp.version}`);
	console.log(`  Spec:         ${API_BASE}${fp.specUrl}`);
}

async function publishCommand(siteId: string): Promise<void> {
	const fp = await api("/d/publish", {
		method: "POST",
		body: JSON.stringify({ siteId }),
	});

	console.log("Published successfully!\n");
	printJson(fp);
}

// ==================== proof-spec commands ====================

function loadSpec(path: string): ProofSpec {
	try {
		const raw = readFileSync(resolvePath(path), "utf8");
		return JSON.parse(raw) as ProofSpec;
	} catch (e) {
		console.error(`Error: failed to read spec: ${(e as Error).message}`);
		process.exit(1);
	}
}

function resolveRunArgs(args: string[]): Record<string, unknown> {
	const argsFlag = flagValue(args, "--args");
	const source = argsFlag ?? (!process.stdin.isTTY ? readStdinSync().trim() : "");
	if (!source) return {};
	try {
		return JSON.parse(source) as Record<string, unknown>;
	} catch (e) {
		const origin = argsFlag ? "--args" : "stdin";
		console.error(`Error: ${origin} must be valid JSON: ${(e as Error).message}`);
		process.exit(1);
	}
}

function specNeedsDom(spec: ProofSpec): boolean {
	const DOM_ASSERTIONS = ["textPresent", "urlMatches", "elementExists", "responseBodyIncludes"];
	return (
		(spec.observe?.some((o) => o.kind === "dom") ?? false) ||
		(spec.act?.some((o) => o.op !== "exec") ?? false) ||
		(spec.assert?.some((a) => DOM_ASSERTIONS.includes(a.kind)) ?? false)
	);
}

async function preflightCdp(cdpPort: string): Promise<void> {
	try {
		const ctrl = new AbortController();
		const timeout = setTimeout(() => ctrl.abort(), 2000);
		const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
			signal: ctrl.signal,
		});
		clearTimeout(timeout);
		if (!resp.ok) throw new Error(`CDP returned HTTP ${resp.status}`);
	} catch (e) {
		console.error(
			`Error: CDP not reachable on port ${cdpPort} (${(e as Error).message}).\n` +
				`Start Chrome For Testing with --remote-debugging-port=${cdpPort} and try again.`,
		);
		process.exit(1);
	}
}

async function runCommand(args: string[]): Promise<void> {
	const specPath = args[0];
	if (!specPath) {
		console.error("Error: run requires a spec path\n  Usage: unsurf run <spec.json> [flags]");
		process.exit(1);
	}

	const spec = loadSpec(specPath);
	const parsedArgs = resolveRunArgs(args);
	const cdpPort = flagValue(args, "--cdp-port") ?? "9222";
	const preNavigate = hasFlag(args, "--pre-navigate");

	if (specNeedsDom(spec)) await preflightCdp(cdpPort);

	const bundle = await runSpec(spec, parsedArgs, { cdpPort, preNavigate });
	printJson(bundle);
	process.exit(bundle.status === "pass" ? 0 : 1);
}

// ==================== Scout ====================

interface ScoutedElement {
	role: string;
	name: string;
	nth: number;
	tag: string;
}

/**
 * Script injected into the target tab via CDP Runtime.evaluate. Walks the DOM
 * and returns a deduplicated list of interactive/landmark elements with their
 * accessible names and role+name+nth coordinates that `Plan.byRoleAndName` will
 * resolve later.
 */
const SCOUT_EVAL = `
	(function() {
		const ROLE_SELECTORS = {
			button: "button, [role=button], input[type=submit], input[type=button]",
			textbox: 'input[type=text], input[type=email], input[type=tel], input[type=url], input[type=password], input:not([type]), textarea, [role=textbox]',
			searchbox: 'input[type=search], [role=searchbox]',
			combobox: "select, [role=combobox]",
			checkbox: 'input[type=checkbox], [role=checkbox]',
			radio: 'input[type=radio], [role=radio]',
			link: "a[href], [role=link]",
			heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
			tab: "[role=tab]",
			menuitem: "[role=menuitem]",
		};
		function accName(el) {
			const al = el.getAttribute && el.getAttribute("aria-label");
			if (al) return al.trim();
			const lb = el.getAttribute && el.getAttribute("aria-labelledby");
			if (lb) { const l = document.getElementById(lb); if (l) return (l.textContent || "").trim(); }
			const tag = el.tagName ? el.tagName.toUpperCase() : "";
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
				if (el.id) {
					const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
					if (lab) return (lab.textContent || "").trim();
				}
				const lbl = el.closest && el.closest("label");
				if (lbl) return (lbl.textContent || "").trim();
				const ph = el.getAttribute && el.getAttribute("placeholder");
				if (ph) return ph.trim();
				const n = el.getAttribute && el.getAttribute("name");
				if (n) return n.trim();
			}
			return ((el.innerText || el.textContent || "")).trim().slice(0, 120);
		}
		function visible(el) {
			const r = el.getBoundingClientRect && el.getBoundingClientRect();
			if (!r) return true;
			if (r.width === 0 && r.height === 0) return false;
			const st = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
			if (st && (st.display === "none" || st.visibility === "hidden")) return false;
			return true;
		}
		const out = [];
		const counters = {};
		for (const role of Object.keys(ROLE_SELECTORS)) {
			const sel = ROLE_SELECTORS[role];
			const nodes = Array.from(document.querySelectorAll(sel));
			for (const el of nodes) {
				if (!visible(el)) continue;
				const name = accName(el);
				if (!name) continue;
				const key = role + "\u0000" + name.toLowerCase();
				const nth = counters[key] || 0;
				counters[key] = nth + 1;
				out.push({ role: role, name: name, nth: nth, tag: (el.tagName || "").toLowerCase() });
				if (out.length > 200) break;
			}
			if (out.length > 200) break;
		}
		return { title: document.title || "", url: location.href, elements: out };
	})()
`;

interface CDPTarget {
	type: string;
	url: string;
	webSocketDebuggerUrl: string;
	title?: string;
}

async function pickCdpTarget(cdpPort: string, url: string): Promise<CDPTarget | null> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 2000);
	try {
		const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: ctrl.signal });
		clearTimeout(t);
		if (!resp.ok) return null;
		const list = (await resp.json()) as CDPTarget[];
		const pages = list.filter((x) => x.type === "page");
		// Prefer an exact origin+path match, then any page already on that origin.
		const exact = pages.find((p) => p.url === url || p.url.startsWith(url));
		if (exact) return exact;
		try {
			const origin = new URL(url).origin;
			const sameOrigin = pages.find((p) => {
				try {
					return new URL(p.url).origin === origin;
				} catch {
					return false;
				}
			});
			if (sameOrigin) return sameOrigin;
		} catch {
			/* ignore */
		}
		return pages[0] ?? null;
	} catch {
		clearTimeout(t);
		return null;
	}
}

async function cdpEval<T>(wsUrl: string, expr: string, navigateTo?: string): Promise<T> {
	const ws = new WebSocket(wsUrl);
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
		if (m.id !== undefined) {
			const p = pending.get(m.id);
			if (!p) return;
			pending.delete(m.id);
			if (m.error) p.reject(new Error(m.error.message ?? "CDP error"));
			else p.resolve(m.result);
		}
	});
	const send = <R>(method: string, params: object = {}): Promise<R> =>
		new Promise((res, rej) => {
			const i = ++id;
			pending.set(i, { resolve: res as (v: unknown) => void, reject: rej });
			ws.send(JSON.stringify({ id: i, method, params }));
		});
	try {
		if (navigateTo) {
			await send("Page.enable");
			await send("Page.navigate", { url: navigateTo });
			await new Promise((r) => setTimeout(r, 3000));
		}
		const r = (await send<{ result: { value?: T } }>("Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true,
		})) as { result: { value?: T } };
		return r.result.value as T;
	} finally {
		ws.close();
	}
}

/** Build a skeleton proof-spec from scouted elements. */
function buildSkeletonSpec(
	url: string,
	title: string,
	elements: readonly ScoutedElement[],
): ProofSpec {
	// Only include roles supported by ProofSpec ElementTarget.
	const allowedRoles = new Set([
		"button",
		"textbox",
		"combobox",
		"searchbox",
		"link",
		"checkbox",
		"radio",
		"heading",
		"img",
		"list",
		"listitem",
		"table",
		"cell",
		"form",
		"region",
		"dialog",
		"tab",
		"tabpanel",
		"navigation",
		"status",
		"option",
		"menu",
		"menuitem",
		"switch",
		"tooltip",
	]);

	const observe = elements
		.filter((e) => allowedRoles.has(e.role))
		.map((e) => ({
			kind: "dom" as const,
			target: {
				role: e.role as never,
				name: e.name,
				...(e.nth > 0 ? { nth: e.nth } : {}),
			},
			as: "exists" as const,
		}));

	return {
		version: "v0",
		target: { url },
		name: "scouted",
		description:
			title && title.length > 0
				? `Scouted skeleton for "${title}". LLM synthesis not yet wired.`
				: "Scouted skeleton — LLM synthesis not yet wired.",
		inputSchema: { type: "object", properties: {}, required: [] },
		observe,
		act: [],
		assert: [],
		risk: "low",
		provenance: {
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "unsurf-cli-scout-stub" },
		},
	};
}

async function scoutCommand(args: string[]): Promise<void> {
	const url = args[0];
	if (!url) {
		console.error("Error: scout requires a URL\n  Usage: unsurf scout <url> [--out <file>]");
		process.exit(1);
	}
	const outFile = flagValue(args, "--out");
	const cdpPort = flagValue(args, "--cdp-port") ?? "9222";

	let spec: ProofSpec;
	const target = await pickCdpTarget(cdpPort, url);
	if (!target) {
		console.error(
			`WARN: scout is a stub — CDP not reachable on :${cdpPort}, emitting empty skeleton.`,
		);
		spec = buildSkeletonSpec(url, "", []);
	} else {
		try {
			// If the chosen tab isn't already on `url`, navigate it there first.
			const navigateTo = target.url === url || target.url.startsWith(url) ? undefined : url;
			const result = await cdpEval<{ title: string; url: string; elements: ScoutedElement[] }>(
				target.webSocketDebuggerUrl,
				SCOUT_EVAL,
				navigateTo,
			);
			console.error(
				`WARN: scout is a stub — snapshotted ${result.elements.length} element(s), no LLM synthesis.`,
			);
			spec = buildSkeletonSpec(result.url || url, result.title, result.elements);
		} catch (e) {
			console.error(
				`WARN: scout is a stub — CDP eval failed (${(e as Error).message}), emitting empty skeleton.`,
			);
			spec = buildSkeletonSpec(url, "", []);
		}
	}

	const json = JSON.stringify(spec, null, 2);
	if (outFile) {
		writeFileSync(resolvePath(outFile), `${json}\n`, "utf8");
		console.error(`Wrote ${outFile}`);
	} else {
		console.log(json);
	}
}

// ==================== Main ====================

// ==================== trace-token command ====================

async function traceTokenCommand(args: string[]): Promise<void> {
	const sub = args[0];
	const endpoint = process.env.TRACE_INGEST_ENDPOINT || "https://trace.coey.dev";
	const root = process.env.TRACE_INGEST_TOKEN;
	if (!root) {
		console.error("Error: TRACE_INGEST_TOKEN (root token) env var is required");
		process.exit(1);
	}

	if (sub === "mint") {
		const owner = requireFlagValue(args, "--owner");
		const scope = flagValue(args, "--scope");
		const quotaStr = flagValue(args, "--quota");
		const body: Record<string, unknown> = { owner };
		if (scope) body.scope = scope;
		if (quotaStr) body.quotaPerDay = Number(quotaStr);

		const res = await fetch(`${endpoint}/admin/tokens`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${root}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			console.error(`mint failed (${res.status}): ${await res.text()}`);
			process.exit(1);
		}
		const data = (await res.json()) as { token: string; owner: string; createdAt: string };
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
		return;
	}

	if (sub === "revoke") {
		const token = args[1];
		if (!token) {
			console.error("Error: trace-token revoke requires <token>");
			process.exit(1);
		}
		const res = await fetch(`${endpoint}/admin/tokens/revoke`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${root}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ token }),
		});
		if (!res.ok) {
			console.error(`revoke failed (${res.status}): ${await res.text()}`);
			process.exit(1);
		}
		const data = await res.json();
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
		return;
	}

	console.error("Error: trace-token requires a subcommand: mint | revoke");
	process.exit(1);
}

// ==================== trace-revoke command ====================
//
// Bumps grantGeneration on a private trace, invalidating every
// previously-issued viewer grant. Returns a fresh grant so the caller
// can keep viewing after the revoke.

async function traceRevokeCommand(args: string[]): Promise<void> {
	const id = args[0];
	if (!id || !/^[0-9a-z]{12}$/.test(id)) {
		console.error("Error: trace-revoke requires a 12-char trace id");
		process.exit(1);
	}
	const endpoint = process.env.TRACE_INGEST_ENDPOINT || "https://trace.coey.dev";
	const root = process.env.TRACE_INGEST_TOKEN;
	if (!root) {
		console.error("Error: TRACE_INGEST_TOKEN (root token) env var is required");
		process.exit(1);
	}
	const res = await fetch(`${endpoint}/admin/traces/${id}/revoke`, {
		method: "POST",
		headers: { authorization: `Bearer ${root}` },
	});
	if (!res.ok) {
		console.error(`trace-revoke failed (${res.status}): ${await res.text()}`);
		process.exit(1);
	}
	const data = await res.json();
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

// ==================== record command ====================

async function recordCommand(args: string[]): Promise<void> {
	const scriptPath = args[0];
	if (!scriptPath) {
		console.error(
			"Error: record requires a script path\n  Usage: unsurf record <script> [--task <str>] [--harness <str>] [--public]",
		);
		process.exit(1);
	}

	const task = flagValue(args, "--task") || scriptPath;
	const harness = flagValue(args, "--harness");
	const cdpPort = flagValue(args, "--cdp-port");
	// v0.4.0: default is private. --public opts into the 365d long-lived
	// shareable grant. --private kept as a no-op alias for transition so
	// existing scripts don't break (the flag already did nothing new).
	const isPublic = args.includes("--public");
	const visibility: "public" | "private" = isPublic ? "public" : "private";

	const absPath = resolvePath(scriptPath);
	const mod = (await import(absPath)) as { default?: unknown; run?: unknown };
	const run = (mod.default ?? mod.run) as
		| ((browser: import("./skills/record/types.js").BrowserHandle) => Promise<unknown>)
		| undefined;
	if (typeof run !== "function") {
		console.error(
			`Error: ${scriptPath} must export a default function or a named 'run' function accepting a BrowserHandle`,
		);
		process.exit(1);
	}

	const { recordAttachedLocal, recordLocal } = await import("./skills/record/index.js");
	const recordOptions = {
		task,
		run,
		...(harness ? { harness } : {}),
		visibility,
	};
	const result = cdpPort
		? await recordAttachedLocal({ ...recordOptions, connect: cdpPort })
		: await recordLocal(recordOptions);

	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	if (result.status === "failed") process.exit(1);
}

// ==================== loop command ====================

async function loopCommand(args: string[]): Promise<void> {
	const goalOrSpec = args[0];
	const northStar = flagValue(args, "--north-star");
	if (!goalOrSpec || !northStar) {
		console.error(
			"Error: loop requires a goal (string or spec.json path) and --north-star\n" +
				"  Usage: unsurf loop <goal|spec.json> --north-star <question> [flags]\n" +
				"    --max-iter <n>    Max iterations (default 5)\n" +
				"    --tick-ms <ms>    Per-iteration wall-clock budget (default 120000)\n" +
				"    --private         Record each iteration as a private trace\n" +
				"  Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (Workers AI),\n" +
				"       TRACE_INGEST_TOKEN (trace upload)",
		);
		process.exit(1);
	}

	const maxIterStr = flagValue(args, "--max-iter");
	const tickMsStr = flagValue(args, "--tick-ms");
	const cdpPort = flagValue(args, "--cdp-port");
	const isPublic = args.includes("--public");
	const visibility: "public" | "private" = isPublic ? "public" : "private";

	// Decide: file path (spec.json) or natural-language string?
	const { loop } = await import("./skills/loop/index.js");
	let spec: string | import("./skills/loop/types.js").LoopSpec = goalOrSpec;
	if (goalOrSpec.endsWith(".json")) {
		try {
			const raw = readFileSync(resolvePath(goalOrSpec), "utf8");
			spec = JSON.parse(raw) as import("./skills/loop/types.js").LoopSpec;
		} catch (e) {
			console.error(`Error: could not read spec file ${goalOrSpec}: ${(e as Error).message}`);
			process.exit(1);
		}
	}

	// Every iteration's recording gets grant-gated; default private, or
	// public (long-lived) when --public is set.
	const { recordAttachedLocal, recordLocal } = await import("./skills/record/index.js");
	const recordFn: import("./skills/loop/types.js").RecordFn = async ({ task, run }) => {
		const recordOptions = { task, run, harness: "loop", visibility };
		const r = cdpPort
			? await recordAttachedLocal({ ...recordOptions, connect: cdpPort })
			: await recordLocal(recordOptions);
		return {
			traceUrl: r.viewerUrl ?? r.url,
			...(r.videoUrl ? { videoUrl: r.videoUrl } : {}),
		};
	};

	const result = await loop({
		spec,
		northStar,
		...(maxIterStr ? { maxIterations: Number(maxIterStr) } : {}),
		...(tickMsStr ? { tickMs: Number(tickMsStr) } : {}),
		recordFn,
		onTick: (t) => {
			const status = t.met ? "✓ met" : t.error ? `✗ ${t.error.slice(0, 80)}` : "· not-met";
			const conf = typeof t.confidence === "number" ? ` (conf=${t.confidence.toFixed(2)})` : "";
			console.error(`[loop] iteration ${t.iteration}: ${status}${conf} ${t.traceUrl ?? ""}`);
		},
	});

	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	if (!result.met) process.exit(result.stopReason === "maxIterations" ? 2 : 1);
}

async function doctorCommand(): Promise<void> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const exec = promisify(execFile);
	let cmux = false;
	let detail = "not found";
	try {
		const result = await exec("cmux", ["--json", "browser", "status"]);
		cmux = true;
		detail = result.stdout.trim().slice(0, 120) || "ready";
	} catch (error) { detail = (error as Error).message.split("\n")[0] ?? "unavailable"; }
	console.log("Unsurf doctor\n");
	console.log(`  cmux browser       ${cmux ? "✓ ready" : "✗ unavailable"}`);
	console.log("  snapshots          ✓ yes");
	console.log("  screenshots        ✓ yes");
	console.log("  persistent auth    ✓ shared browser profile");
	console.log("  isolated identity  ✗ no (use hosted Browser Run when required)");
	console.log("  video recording    ✗ no on cmux WKWebView; optional evidence");
	console.log(`  Workers AI         ${process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN ? "✓ configured" : "· optional credentials missing"}`);
	if (!cmux) console.log(`\n  cmux detail: ${detail}`);
	if (!cmux) process.exitCode = 1;
}

async function investigateCommand(args: string[]): Promise<void> {
	const symptom = requireFlagValue(args, "--symptom");
	const brokenUrl = requireFlagValue(args, "--broken");
	const { investigate } = await import("./investigate/index.js");
	const fixedUrl = flagValue(args, "--fixed");
	const outDirFlag = flagValue(args, "--out");
	const runsFlag = flagValue(args, "--runs");
	const selector = flagValue(args, "--selector");
	const attribute = flagValue(args, "--attribute");
	const failureValue = flagValue(args, "--failure-value");
	const successValue = flagValue(args, "--success-value");
	console.error("[unsurf] opening four independent cmux investigators…");
	const { receipt, outDir } = await investigate({
		symptom, brokenUrl,
		...(fixedUrl ? { fixedUrl } : {}), ...(outDirFlag ? { outDir: outDirFlag } : {}),
		...(runsFlag ? { runs: Number(runsFlag) } : {}), ...(selector ? { selector } : {}),
		...(attribute ? { attribute } : {}), ...(failureValue ? { failureValue } : {}),
		...(successValue ? { successValue } : {}),
	});
	console.log(`\n${receipt.passed ? "✓ PASS — fix confirmed" : "✗ FAIL — gate not satisfied"}`);
	console.log(`  candidates: ${receipt.candidates.filter((c) => c.observed).length}/${receipt.candidates.length}`);
	console.log(`  broken:     ${receipt.broken.filter((r) => r.failureObserved).length}/${receipt.broken.length} reproduced`);
	if (receipt.fixedUrl) console.log(`  fixed:      ${receipt.fixed.filter((r) => !r.failureObserved).length}/${receipt.fixed.length} clean`);
	console.log(`\n  Repro:  ${resolvePath(outDir, "repro.json")}`);
	console.log(`  Report: ${resolvePath(outDir, "report.md")}`);
	console.log(`  Result: ${resolvePath(outDir, "result.json")}`);
	if (!receipt.passed) process.exitCode = 1;
}

async function replayCommand(args: string[]): Promise<void> {
	const file = args[0];
	if (!file || file.startsWith("--")) throw new Error("replay requires <repro.json>");
	const target = requireFlagValue(args, "--target");
	const { loadRepro, replayRepro } = await import("./investigate/index.js");
	const outDir = flagValue(args, "--out");
	const runs = flagValue(args, "--runs");
	const results = await replayRepro(await loadRepro(file), { target, ...(outDir ? { outDir } : {}), ...(runs ? { runs: Number(runs) } : {}) });
	printJson(results);
	if (results.some((result) => result.error)) process.exitCode = 1;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		usage();
	}

	try {
		switch (command) {
			case "doctor":
				await doctorCommand();
				break;

			case "investigate":
				await investigateCommand(args.slice(1));
				break;

			case "replay":
				await replayCommand(args.slice(1));
				break;

			case "search": {
				const query = args.slice(1).join(" ");
				if (!query) {
					console.error("Error: search requires a query\n  Usage: unsurf search <query>");
					process.exit(1);
				}
				await searchCommand(query);
				break;
			}

			case "lookup": {
				const domain = args[1];
				if (!domain) {
					console.error("Error: lookup requires a domain\n  Usage: unsurf lookup <domain>");
					process.exit(1);
				}
				await lookupCommand(domain);
				break;
			}

			case "publish": {
				const siteId = args[1];
				if (!siteId) {
					console.error("Error: publish requires a siteId\n  Usage: unsurf publish <siteId>");
					process.exit(1);
				}
				await publishCommand(siteId);
				break;
			}

			case "run":
				await runCommand(args.slice(1));
				break;

			case "scout":
				await scoutCommand(args.slice(1));
				break;

			case "trace-token":
				await traceTokenCommand(args.slice(1));
				break;

			case "trace-revoke":
				await traceRevokeCommand(args.slice(1));
				break;

			case "loop":
				await loopCommand(args.slice(1));
				break;

			case "record":
				await recordCommand(args.slice(1));
				break;

			default:
				console.error(`Unknown command: ${command}`);
				usage();
		}
	} catch (err) {
		console.error((err as Error).message);
		process.exit(1);
	}
}

main();
