// unsurf content script
//
// On every page load:
//   1. Inject the @mcp-b WebMCP polyfill + embed.js into the page's MAIN world.
//      Content scripts run in an ISOLATED world; the polyfill has to live in the
//      page context to expose navigator.modelContext to the page + the embed.
//   2. Fetch the tool catalog for the current URL from the Directory.
//   3. Pass the catalog to the injected script, which registers each tool.
//   4. Apply RiskLabeler on the way through — never trust catalog-stored risk.

(async () => {
	const UNSURF_API = (await chrome.storage.local.get("unsurf_api"))?.unsurf_api || "https://unsurf-api.coey.dev";
	const origin = location.origin;
	const href = location.href;

	// ---- Step 1: inject the polyfill + embed into MAIN world ----
	// Content scripts can't set navigator.modelContext for the page directly (isolated world).
	// We inject a tag that loads our bundled script from web_accessible_resources.
	function inject(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement("script");
			s.src = chrome.runtime.getURL(src);
			s.onload = () => { s.remove(); resolve(); };
			s.onerror = () => { s.remove(); reject(new Error(`failed to inject ${src}`)); };
			(document.head || document.documentElement).appendChild(s);
		});
	}

	try {
		await inject("polyfill.iife.js");
		await inject("injected.js"); // page-side registrar + window event listener
		await inject("embed.js");    // connects to webmcp-local-relay
	} catch (e) {
		console.warn("[unsurf] injection failed:", e?.message ?? e);
		return;
	}

	// ---- Step 2: fetch catalog for this URL ----
	async function fetchCatalog() {
		try {
			const u = new URL(`${UNSURF_API}/d/catalog`);
			u.searchParams.set("url", href);
			const r = await fetch(u.toString(), { method: "GET" });
			if (!r.ok) return null;
			const j = await r.json();
			// Expected shape: { tools: [...] } — a tool-spec.v0.json
			if (!j || !Array.isArray(j.tools)) return null;
			return j;
		} catch {
			return null;
		}
	}

	const catalog = await fetchCatalog();
	if (!catalog) {
		// No catalog for this page. Still record the visit for the popup so user knows we tried.
		chrome.runtime.sendMessage({ type: "unsurf:visit", origin, href, catalog: null }).catch(() => {});
		return;
	}

	// ---- Step 3: apply RiskLabeler ----
	// Inlined deterministic check — the Directory already relabels, but belt-and-suspenders.
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
	for (const t of catalog.tools) {
		const claimed = t.risk;
		t.risk = computeRisk(t.dsl);
		if (claimed && claimed !== t.risk) {
			console.warn(`[unsurf] relabeled "${t.name}": ${claimed} -> ${t.risk}`);
		}
	}

	// ---- Step 4: hand catalog to injected.js via window message ----
	// (Content script -> main-world bridge is always postMessage.)
	window.postMessage({ type: "unsurf:register-catalog", catalog }, "*");

	chrome.runtime.sendMessage({
		type: "unsurf:visit",
		origin,
		href,
		catalog: { tool_count: catalog.tools.length, fingerprint: catalog.fingerprint },
	}).catch(() => {});
})();
