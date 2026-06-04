#!/usr/bin/env bun
/**
 * unsurf-daemon — attach to an existing Chrome via CDP, inject
 * `navigator.modelContext` into every page, register tools from the unsurf
 * Directory per-URL. No extension required.
 *
 * Why this exists: Chrome extensions are blocked by enterprise MDM on many
 * managed machines (ExtensionInstallBlocklist=["*"]). CDP-based injection
 * works where --load-extension does not. It's also a cleaner architecture:
 *   - Works against any Chromium-based browser: Chrome, Chrome For Testing,
 *     Arc, Edge, Brave, Chromium, Dia — anything exposing CDP
 *   - No manifest.json, no unpacked extension to manage
 *   - Polyfill runs in every new document via Page.addScriptToEvaluateOnNewDocument
 *
 * Usage:
 *   bun run examples/webmcp-daemon/daemon.ts
 *
 * Or compile once, run anywhere:
 *   bun build examples/webmcp-daemon/daemon.ts --compile --outfile unsurf-daemon
 *   ./unsurf-daemon
 *
 * Prereqs:
 *   - Chrome launched with --remote-debugging-port=9222 (enterprise MDM may
 *     silently block this on your "work" Chrome; use Chrome For Testing for
 *     a non-managed sandbox)
 *
 * Env:
 *   UNSURF_API — override Directory endpoint (default: https://unsurf-api.coey.dev)
 *   CDP_PORT   — override CDP port (default: 9222)
 *   CATALOG_FILE — path to a local JSON file; if set, use this catalog for
 *                  EVERY url instead of fetching from the Directory. Useful
 *                  for testing and offline demos.
 *
 * Exit with Ctrl+C.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ---------------- Config ----------------

const UNSURF_API = process.env.UNSURF_API ?? "https://unsurf-api.coey.dev";
const CATALOG_FILE = process.env.CATALOG_FILE;
const DEV_TOOLS_PORT_FILE = resolve(
	homedir(),
	"Library/Application Support/Google/Chrome/DevToolsActivePort",
);
const CDP_PORT = process.env.CDP_PORT ?? "9222";

function log(...args: unknown[]) {
	console.log("[unsurf]", ...args);
}

// ---------------- CDP discovery ----------------

async function findChromeWebSocketUrl(): Promise<string> {
	// Prefer explicit port via /json/version (works for Chrome For Testing too)
	try {
		const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
			signal: AbortSignal.timeout(2000),
		});
		if (r.ok) {
			const info = (await r.json()) as { webSocketDebuggerUrl: string };
			return info.webSocketDebuggerUrl;
		}
	} catch {
		// fall through
	}
	// Fallback: Chrome's DevToolsActivePort file (default profile dir)
	if (existsSync(DEV_TOOLS_PORT_FILE)) {
		const content = readFileSync(DEV_TOOLS_PORT_FILE, "utf8").trim();
		const [portStr, wsPath] = content.split("\n");
		if (portStr && wsPath) return `ws://127.0.0.1:${portStr}${wsPath}`;
	}
	throw new Error(
		`CDP not reachable on port ${CDP_PORT}.\n` +
			`  Launch Chrome with --remote-debugging-port=${CDP_PORT} first.\n` +
			`  Managed Chromes often silently refuse this flag — use Chrome For Testing.`,
	);
}

// ---------------- Minimal CDP client (Bun built-in WebSocket) ----------------

interface CDPMessage {
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string };
	sessionId?: string;
}

class CDP {
	private ws!: WebSocket;
	private msgId = 0;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private events = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();

	async connect(wsUrl: string) {
		this.ws = new WebSocket(wsUrl);
		await new Promise<void>((res, rej) => {
			this.ws.addEventListener("open", () => res(), { once: true });
			this.ws.addEventListener("error", (e) => rej(new Error(String(e))), { once: true });
		});
		this.ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(String(ev.data)) as CDPMessage;
			if (typeof msg.id === "number" && this.pending.has(msg.id)) {
				const p = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				if (msg.error) p?.reject(new Error(msg.error.message ?? "CDP error"));
				else p?.resolve(msg.result);
				return;
			}
			if (msg.method && this.events.has(msg.method)) {
				for (const h of this.events.get(msg.method) ?? []) {
					h(msg.params, msg.sessionId);
				}
			}
		});
	}

	send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		const id = ++this.msgId;
		const payload: Record<string, unknown> = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		return new Promise((res, rej) => {
			this.pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
			this.ws.send(JSON.stringify(payload));
		});
	}

	on(method: string, handler: (params: unknown, sessionId?: string) => void) {
		if (!this.events.has(method)) this.events.set(method, []);
		this.events.get(method)!.push(handler);
	}
}

// ---------------- Injected payload (runs in every page's main world) ----------------

const INJECTED_PAYLOAD = String.raw`
(() => {
	if (window.__unsurf_daemon__) return;
	window.__unsurf_daemon__ = { tools: new Map(), version: "0.0.1" };

	// ---- minimal WebMCP polyfill ----
	if (!navigator.modelContext) {
		navigator.modelContext = {
			registerTool(spec) {
				if (!spec || !spec.name) return { success: false, error: "tool.name required" };
				window.__unsurf_daemon__.tools.set(spec.name, spec);
				return { success: true };
			},
			unregisterTool(name) {
				return window.__unsurf_daemon__.tools.delete(name);
			},
			getTools() {
				return Array.from(window.__unsurf_daemon__.tools.values()).map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
				}));
			},
			executeTool(name, args) {
				const t = window.__unsurf_daemon__.tools.get(name);
				if (!t) throw new Error("unknown tool: " + name);
				return t.execute(args);
			},
		};
	}

	// ---- deterministic risk re-labeler (mirror of src/services/RiskLabeler.ts) ----
	const DSL_OPS = new Set(["click", "fill", "select", "check", "submit", "read"]);
	const DESTRUCTIVE_RE = /\b(delete|remove|pay|buy|send|confirm|destroy|cancel|wipe|exfiltrate|purge|erase|trash|charge|deactivate|uninstall)\b/i;

	function computeRisk(dsl) {
		if (!Array.isArray(dsl) || dsl.length === 0) return "medium";
		if (dsl.every(op => op.op === "read")) return "low";
		for (const op of dsl) {
			if (op.op === "submit") return "high";
			if (op.op === "click" && typeof op.target?.name === "string" && DESTRUCTIVE_RE.test(op.target.name)) return "high";
		}
		return "medium";
	}

	// ---- role -> CSS selector map for resolvers ----
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
	};

	function accessibleName(el) {
		const al = el.getAttribute?.("aria-label");
		if (al) return al.trim();
		const labelledby = el.getAttribute?.("aria-labelledby");
		if (labelledby) {
			const l = document.getElementById(labelledby);
			if (l) return (l.textContent ?? "").trim();
		}
		const tag = el.tagName?.toUpperCase();
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
			if (el.id) {
				const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
				if (lab) return (lab.textContent ?? "").trim();
			}
			const label = el.closest?.("label");
			if (label) return (label.textContent ?? "").trim();
			const ph = el.getAttribute?.("placeholder");
			if (ph) return ph.trim();
			const n = el.getAttribute?.("name");
			if (n) return n.trim();
		}
		return (el.textContent ?? "").trim();
	}

	function byRoleAndName(role, name, nth = 0) {
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

	function substitute(v, args) {
		if (typeof v !== "string") return v;
		return v.replace(/\{\{(\w+)\}\}/g, (_m, k) => args[k] !== undefined ? String(args[k]) : "{{" + k + "}}");
	}

	window.__unsurf_daemon__.runDsl = function runDsl(dsl, args) {
		const reads = [];
		for (const op of dsl) {
			if (!DSL_OPS.has(op.op)) throw new Error("unknown op " + op.op);
			const el = byRoleAndName(op.target.role, op.target.name, op.target.nth ?? 0);
			if (!el) throw new Error("target not found: " + op.target.role + ':"' + op.target.name + '"');
			if (op.op === "click") el.click();
			else if (op.op === "fill") {
				const v = substitute(op.value, args);
				const desc = Object.getOwnPropertyDescriptor(
					el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
					"value"
				);
				if (desc?.set) desc.set.call(el, v); else el.value = v;
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
			}
			else if (op.op === "select") {
				const v = substitute(op.value, args);
				el.value = v;
				el.dispatchEvent(new Event("change", { bubbles: true }));
			}
			else if (op.op === "check") {
				if (op.value && !el.checked) el.click();
				else if (!op.value && el.checked) el.click();
			}
			else if (op.op === "submit") {
				const form = el.closest?.("form") || (el.tagName === "FORM" ? el : null);
				if (!form) throw new Error("submit: no form context");
				if (form.requestSubmit) form.requestSubmit(); else form.submit();
			}
			else if (op.op === "read") {
				const as = op.as ?? "text";
				if (as === "text") reads.push(el.innerText ?? el.textContent ?? "");
				else if (as === "value") reads.push(el.value ?? "");
				else if (as === "attr") reads.push(el.getAttribute?.(op.attr) ?? "");
			}
		}
		return reads.length ? reads.join("\n") : "ok";
	};

	window.__unsurf_daemon__.registerCatalog = function(catalog) {
		if (!catalog?.tools) return 0;
		let registered = 0;
		for (const tool of catalog.tools) {
			const claimed = tool.risk;
			tool.risk = computeRisk(tool.dsl);
			if (claimed && claimed !== tool.risk) {
				console.warn('[unsurf] relabeled "' + tool.name + '": ' + claimed + " -> " + tool.risk);
			}
			const reg = navigator.modelContext.registerTool({
				name: tool.name,
				description: tool.description + " [risk:" + tool.risk + "]",
				inputSchema: tool.inputSchema,
				execute: async (args) => {
					if (tool.risk === "high") {
						const ok = window.confirm(
							"unsurf: confirm HIGH-RISK call\n\n" +
							"Tool: " + tool.name + "\n" +
							"Page: " + location.hostname + "\n\n" +
							"Arguments:\n" + JSON.stringify(args, null, 2) + "\n\n" +
							"Proceed?"
						);
						if (!ok) return { content: [{ type: "text", text: "cancelled by user (HITL)" }] };
					}
					try {
						const result = window.__unsurf_daemon__.runDsl(tool.dsl, args ?? {});
						return { content: [{ type: "text", text: String(result) }] };
					} catch (e) {
						return { content: [{ type: "text", text: "error: " + (e?.message ?? e) }], isError: true };
					}
				},
			});
			if (reg?.success !== false) registered++;
		}
		return registered;
	};

	console.log("[unsurf] daemon polyfill ready on " + location.host);
})();
`;

// ---------------- Catalog fetcher ----------------

interface ToolSpec {
	name: string;
	description: string;
	inputSchema: unknown;
	dsl: unknown[];
	risk?: "low" | "medium" | "high";
}
interface Catalog {
	version: string;
	url?: string;
	tools: ToolSpec[];
}

let LOCAL_CATALOG: Catalog | null = null;
if (CATALOG_FILE) {
	try {
		LOCAL_CATALOG = JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
		log(`using local catalog (${LOCAL_CATALOG?.tools?.length ?? 0} tools) from ${CATALOG_FILE}`);
	} catch (e) {
		log(`failed to load CATALOG_FILE: ${(e as Error).message}`);
		process.exit(1);
	}
}

async function fetchCatalogForUrl(url: string): Promise<Catalog | null> {
	if (LOCAL_CATALOG) return LOCAL_CATALOG;
	try {
		const catalogUrl = new URL(`${UNSURF_API}/d/catalog`);
		catalogUrl.searchParams.set("url", url);
		const r = await fetch(catalogUrl, { signal: AbortSignal.timeout(5000) });
		if (!r.ok) return null;
		const j = (await r.json()) as Catalog;
		if (!j || !Array.isArray(j.tools) || j.tools.length === 0) return null;
		return j;
	} catch {
		return null;
	}
}

// ---------------- Main ----------------

async function main() {
	log("unsurf daemon starting…");
	log(`catalog source: ${LOCAL_CATALOG ? `local (${CATALOG_FILE})` : UNSURF_API}`);

	const wsUrl = await findChromeWebSocketUrl();
	log(`CDP endpoint: ${wsUrl}`);

	const cdp = new CDP();
	await cdp.connect(wsUrl);
	log("connected to Chrome");

	await cdp.send("Target.setDiscoverTargets", { discover: true });

	// Map: sessionId -> { targetId, lastRegisteredUrl }
	const sessions = new Map<string, { targetId: string; lastRegisteredUrl?: string }>();
	const sessionByTarget = new Map<string, string>();

	async function attachToTarget(targetId: string, initialUrl: string) {
		if (sessionByTarget.has(targetId)) return;
		try {
			const { sessionId } = (await cdp.send("Target.attachToTarget", {
				targetId,
				flatten: true,
			})) as { sessionId: string };
			sessions.set(sessionId, { targetId });
			sessionByTarget.set(targetId, sessionId);

			await cdp.send("Page.enable", {}, sessionId);
			await cdp.send("Runtime.enable", {}, sessionId);
			await cdp.send(
				"Page.addScriptToEvaluateOnNewDocument",
				{ source: INJECTED_PAYLOAD },
				sessionId,
			);
			// For already-loaded pages, inject now too (polyfill is idempotent)
			await cdp
				.send(
					"Runtime.evaluate",
					{ expression: INJECTED_PAYLOAD, returnByValue: false },
					sessionId,
				)
				.catch(() => {});

			log(`attached target ${targetId.slice(0, 8)} (${new URL(initialUrl).hostname || initialUrl})`);

			// Register tools for the currently-loaded URL
			await maybeRegisterForSession(sessionId, initialUrl);
		} catch (e) {
			// chrome:// and devtools:// targets reject attachment — quiet skip
			const msg = (e as Error).message;
			if (!/not attached|cannot be attached/i.test(msg)) {
				log(`attach failed for ${targetId.slice(0, 8)}: ${msg}`);
			}
		}
	}

	async function maybeRegisterForSession(sessionId: string, url: string) {
		const session = sessions.get(sessionId);
		if (!session) return;

		// Always re-fetch + re-register on every navigation event. Reloads, SPA
		// route changes, and back/forward all produce Page.frameNavigated; all of
		// them reset navigator.modelContext (or will soon). Cheap, reliable.
		const catalog = await fetchCatalogForUrl(url);
		if (!catalog) {
			session.lastRegisteredUrl = url;
			return; // silent — no need to log every miss
		}

		const payload = JSON.stringify(catalog);
		// Wait for the polyfill to be present. addScriptToEvaluateOnNewDocument
		// runs before any user script, but its async evaluation may not have
		// finished by the time Page.frameNavigated fires. Poll briefly.
		const waitExpr = `(async () => {
			for (let i = 0; i < 40; i++) {
				if (window.__unsurf_daemon__) return true;
				await new Promise(r => setTimeout(r, 50));
			}
			return false;
		})()`;
		try {
			const ready = (await cdp.send(
				"Runtime.evaluate",
				{ expression: waitExpr, awaitPromise: true, returnByValue: true },
				sessionId,
			)) as { result: { value?: boolean } };
			if (!ready.result.value) {
				log(`${url} — polyfill never appeared; skipping`);
				return;
			}

			const result = (await cdp.send(
				"Runtime.evaluate",
				{
					expression: `window.__unsurf_daemon__.registerCatalog(${payload})`,
					returnByValue: true,
				},
				sessionId,
			)) as { result: { value?: number } };
			const count = result.result.value ?? 0;
			const host = (() => {
				try {
					return new URL(url).hostname;
				} catch {
					return url;
				}
			})();
			if (count > 0) log(`${host} — registered ${count} tool(s)`);
			session.lastRegisteredUrl = url;
		} catch (e) {
			log(`register failed on ${url}: ${(e as Error).message}`);
		}
	}

	// Attach to existing pages
	const { targetInfos } = (await cdp.send("Target.getTargets")) as {
		targetInfos: Array<{ targetId: string; type: string; url: string }>;
	};
	const pages = targetInfos.filter(
		(t) => t.type === "page" && !t.url.startsWith("chrome://") && !t.url.startsWith("devtools://"),
	);
	log(`found ${pages.length} page target(s) to attach`);
	for (const t of pages) await attachToTarget(t.targetId, t.url);

	// New tab created
	cdp.on("Target.targetCreated", async (params) => {
		const { targetInfo } = params as {
			targetInfo: { targetId: string; type: string; url: string };
		};
		if (targetInfo.type !== "page") return;
		if (
			targetInfo.url.startsWith("chrome://") ||
			targetInfo.url.startsWith("devtools://")
		) return;
		await attachToTarget(targetInfo.targetId, targetInfo.url);
	});

	// Tab closed
	cdp.on("Target.targetDestroyed", (params) => {
		const { targetId } = params as { targetId: string };
		const sessionId = sessionByTarget.get(targetId);
		if (sessionId) {
			sessions.delete(sessionId);
			sessionByTarget.delete(targetId);
		}
	});

	// Page navigation — fire per session (Page.enable was called per-session so the
	// event arrives with the session's sessionId in the envelope)
	cdp.on("Page.frameNavigated", async (params, sessionId) => {
		if (!sessionId || !sessions.has(sessionId)) return;
		const { frame } = params as { frame: { parentId?: string; url: string } };
		if (frame.parentId) return; // top-level only
		if (
			!frame.url ||
			frame.url === "about:blank" ||
			frame.url.startsWith("chrome://") ||
			frame.url.startsWith("devtools://")
		) return;
		await maybeRegisterForSession(sessionId, frame.url);
	});

	log("listening. Ctrl+C to quit.");
	await new Promise(() => {
		// never resolves
	});
}

main().catch((e) => {
	console.error("[unsurf] fatal:", e);
	process.exit(1);
});
