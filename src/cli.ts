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
	console.log(`unsurf — Turn any website into a typed API

Usage:
  unsurf search <query>                    Search the API directory
  unsurf lookup <domain>                   Get fingerprint for a domain
  unsurf publish <siteId>                  Publish a scouted site to the directory

  unsurf run <spec.json> [flags]           Execute a proof-spec.v0 JSON
    --args <json>                          Inline args JSON (or pass via stdin)
    --cdp-port <port>                      CDP port (default 9222)
    --pre-navigate                         Navigate the tab to target.url first

  unsurf scout <url> [flags]               Snapshot DOM; emit skeleton proof-spec
    --out <file>                           Write to file instead of stdout
    --cdp-port <port>                      CDP port (default 9222)

Examples:
  unsurf search "payment processing"
  unsurf lookup stripe.com
  unsurf run spec.json --args '{"q":"hello"}'
  unsurf scout https://coey.dev --out spec.json`);
	process.exit(0);
}

/** Parse flag value from argv. Returns undefined if not present. */
function flagValue(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	if (i === -1 || i === args.length - 1) return undefined;
	return args[i + 1];
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

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		usage();
	}

	try {
		switch (command) {
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
