/**
 * trace viewer + ingest worker.
 *
 * Serves the `trace.coey.dev/r/:id` URL family and accepts bundle uploads at
 * `/upload`. v0.0.1 collapses the two-Worker split from SECURITY.md into one
 * Worker because the separation adds a service binding and an Access app
 * without any real security gain while the only caller is Jordan's laptop.
 * Revisit when there are >1 upload clients.
 *
 * Bindings come from alchemy.run.ts:
 *   STORAGE                    R2 bucket (shared with the main unsurf worker;
 *                              trace/ prefix keys every object)
 *   TRACE_TOKENS               KV namespace, keyed by SHA-256(token), values
 *                              `{ owner, scope, createdAt, revokedAt?, quotaPerDay? }`
 *   TRACE_INGEST_RATE_LIMIT    Workers Rate Limit binding (120/min/token)
 *   TRACE_SIGNING_KEY          32-byte hex, HMAC key for signed video URLs
 *   TRACE_INGEST_TOKEN         legacy single-token fallback; auth succeeds
 *                              if header matches this OR a KV entry exists
 *
 * Auth order on POST /upload:
 *   1. If KV lookup finds the token hash AND it is not revoked, accept.
 *      Rate-limit key = token hash.
 *   2. Else if TRACE_INGEST_TOKEN is set and matches exactly, accept.
 *      Rate-limit key = "legacy".
 *   3. Else 401.
 *
 * Bundle layout in R2 (see src/skills/record/SPEC.md):
 *   trace/<id>.webm
 *   trace/<id>/trace.json
 *   trace/<id>/result.json
 *   trace/<id>/meta.json
 */

interface TokenRecord {
	owner: string;
	scope?: string;
	createdAt: string;
	revokedAt?: string;
	quotaPerDay?: number;
}

interface RateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
	STORAGE: R2Bucket;
	TRACE_TOKENS: KVNamespace;
	TRACE_INGEST_RATE_LIMIT: RateLimitBinding;
	TRACE_SIGNING_KEY: string;
	TRACE_INGEST_TOKEN: string;
}

const ID_REGEX = /^[0-9a-z]{12}$/;
const VIDEO_SIGN_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

const JSON_HEADERS: HeadersInit = {
	"content-type": "application/json",
	"cache-control": "public, max-age=86400",
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...JSON_HEADERS, ...headers },
	});
}

function err(message: string, status = 400): Response {
	return json({ error: message }, status);
}

function r2Key(id: string, part: "video" | "trace" | "result" | "meta"): string {
	if (part === "video") return `trace/${id}.webm`;
	return `trace/${id}/${part}.json`;
}

// ==================== Signing ====================

async function importSigningKey(hex: string): Promise<CryptoKey> {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return crypto.subtle.importKey(
		"raw",
		bytes as BufferSource,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function hex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function sign(key: CryptoKey, message: string): Promise<string> {
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return hex(sig);
}

async function verify(key: CryptoKey, message: string, sigHex: string): Promise<boolean> {
	// Constant-time compare via subtle.verify.
	const bytes = new Uint8Array(sigHex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
	}
	return crypto.subtle.verify(
		"HMAC",
		key,
		bytes as BufferSource,
		new TextEncoder().encode(message),
	);
}

async function signVideoUrl(
	env: Env,
	origin: string,
	id: string,
	ttlSeconds = VIDEO_SIGN_DEFAULT_TTL_SECONDS,
): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
	const key = await importSigningKey(env.TRACE_SIGNING_KEY);
	const sig = await sign(key, `${id}|${exp}`);
	return `${origin}/r/${id}/video.webm?exp=${exp}&sig=${sig}`;
}

// ==================== Viewer grants (private traces) ====================
//
// A "viewer grant" is an HMAC signature over `${id}|view|${exp}`. Passed
// as ?vt=<exp>.<sig> on every request to a private trace's resources.
// Any request missing or presenting a bad grant for a private trace
// returns 404 (we don't leak existence).
//
// We keep video-URL signing separate from viewer grants on purpose:
// viewer grants authorize access to the trace as a whole, video sigs
// are short-lived playback tokens the viewer mints on demand.

// Two grant TTLs, matching the two explicit visibility choices.
//   "private" = presumed sensitive, 7-day share window.
//   "public"  = long-lived share, 365-day window. Still grant-gated, still
//              revocable via grantGeneration. NOT a bare URL.
const VIEWER_GRANT_TTL_PRIVATE_SECONDS = 7 * 24 * 60 * 60;
const VIEWER_GRANT_TTL_PUBLIC_SECONDS = 365 * 24 * 60 * 60;

interface TraceMeta {
	visibility?: "public" | "private";
	grantGeneration?: number;
	[k: string]: unknown;
}

function grantTtlFor(visibility: "public" | "private"): number {
	return visibility === "public"
		? VIEWER_GRANT_TTL_PUBLIC_SECONDS
		: VIEWER_GRANT_TTL_PRIVATE_SECONDS;
}

async function readMeta(env: Env, id: string): Promise<TraceMeta | null> {
	const obj = await env.STORAGE.get(r2Key(id, "meta"));
	if (!obj) return null;
	try {
		return (await obj.json()) as TraceMeta;
	} catch {
		return {};
	}
}

/**
 * Mint a viewer grant. Grants embed the meta's current `grantGeneration`
 * so bumping the counter in meta.json revokes every previously-issued
 * grant for that one trace — no KV, no key rotation, surgical.
 */
async function mintViewerGrant(
	env: Env,
	id: string,
	generation: number,
	ttl = VIEWER_GRANT_TTL_PRIVATE_SECONDS,
): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + ttl;
	const key = await importSigningKey(env.TRACE_SIGNING_KEY);
	const sig = await sign(key, `${id}|view|${generation}|${exp}`);
	return `${exp}.${generation}.${sig}`;
}

async function verifyViewerGrant(
	env: Env,
	id: string,
	currentGeneration: number,
	vt: string,
): Promise<boolean> {
	const parts = vt.split(".");
	if (parts.length !== 3) return false;
	const [expStr, genStr, sigHex] = parts;
	const exp = Number(expStr);
	const generation = Number(genStr);
	if (!exp || Number.isNaN(generation) || !sigHex) return false;
	if (exp < Math.floor(Date.now() / 1000)) return false;
	if (generation !== currentGeneration) return false;
	const key = await importSigningKey(env.TRACE_SIGNING_KEY);
	return verify(key, `${id}|view|${generation}|${exp}`, sigHex);
}

/**
 * Gate every request to a private trace's resources. Returns:
 *   - null if the caller may proceed
 *   - a Response to send back otherwise (404 so existence isn't leaked)
 */
/**
 * Gate every request to a trace's resources.
 *
 *   visibility "private"  → grant required (7d default)
 *   visibility "public"   → grant required (365d default) — intentionally
 *                            NOT bare-URL; bare `/r/<id>` 404s.
 *   visibility missing    → grandfather: bare-URL allowed. This is for
 *                            bundles uploaded BEFORE the private-by-default
 *                            migration. New uploads always write an
 *                            explicit visibility.
 *
 *   grantGeneration mismatch  → 404 (revoked)
 *   grant tampering / expiry  → 404
 *
 * Returns:
 *   - null if the caller may proceed
 *   - a Response to send back otherwise (404 so existence isn't leaked)
 */
async function enforceVisibility(
	request: Request,
	env: Env,
	id: string,
	searchParams: URLSearchParams,
): Promise<Response | null> {
	const meta = await readMeta(env, id);
	if (meta === null) return err("not found", 404);
	// Grandfather: pre-migration bundles have no visibility field, stay bare.
	if (meta.visibility !== "private" && meta.visibility !== "public") return null;
	const vt = searchParams.get("vt") || "";
	if (!vt) return err("not found", 404);
	const gen = typeof meta.grantGeneration === "number" ? meta.grantGeneration : 0;
	const ok = await verifyViewerGrant(env, id, gen, vt);
	if (!ok) return err("not found", 404);
	void request;
	return null;
}

// ==================== OG card (SVG) ====================

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function ogSvg(
	id: string,
	task: string,
	status: "succeeded" | "failed",
	durationMs: number,
): string {
	const taskClean = escapeXml(task.length > 80 ? `${task.slice(0, 77)}…` : task);
	const statusLabel =
		status === "succeeded" ? `Succeeded · ${(durationMs / 1000).toFixed(1)}s` : "Failed";
	const statusBg = status === "succeeded" ? "#e7f7ee" : "#fff4f4";
	const statusFg = status === "succeeded" ? "#0b6b4f" : "#a41c1c";
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#ffffff"/>
			<stop offset="1" stop-color="#f6f9fc"/>
		</linearGradient>
	</defs>
	<rect width="1200" height="630" fill="url(#bg)"/>
	<rect x="0" y="0" width="1200" height="6" fill="#635bff"/>
	<text x="80" y="130" font-family="-apple-system, 'SF Pro Text', Inter, sans-serif" font-size="28" font-weight="600" fill="#0a2540">
		unsurf <tspan fill="#e3e8ee">∕</tspan> <tspan font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="24" fill="#697386">${escapeXml(id)}</tspan>
	</text>
	<text x="80" y="260" font-family="-apple-system, 'SF Pro Text', Inter, sans-serif" font-size="52" font-weight="600" fill="#0a2540">
		${taskClean}
	</text>
	<g transform="translate(80,360)">
		<rect width="340" height="48" rx="24" fill="${statusBg}"/>
		<circle cx="26" cy="24" r="6" fill="${statusFg}"/>
		<text x="48" y="32" font-family="-apple-system, 'SF Pro Text', Inter, sans-serif" font-size="20" font-weight="500" fill="${statusFg}">
			${escapeXml(statusLabel)}
		</text>
	</g>
	<text x="80" y="560" font-family="-apple-system, 'SF Pro Text', Inter, sans-serif" font-size="20" fill="#697386">
		trace.coey.dev · recorded browser session
	</text>
</svg>`;
}

// ==================== Viewer HTML ====================

function viewerHtml(id: string, origin: string, vt: string, embed = false): string {
	// Clinical, Stripe-adjacent light palette. Values chosen from the
	// Stripe dashboard design system and tweaked for high contrast on
	// small text. All styles inlined; no external CSS.
	const qs = vt ? `?vt=${encodeURIComponent(vt)}` : "";
	const ogUrl = `${origin}/r/${id}/og.svg${qs}`;
	const pageUrl = `${origin}/r/${id}${qs}`;
	return `<!doctype html>
<html lang="en" data-embed="${embed ? "1" : "0"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>trace ${id} — unsurf</title>
<meta property="og:type" content="video.other">
<meta property="og:title" content="unsurf trace ${id}">
<meta property="og:site_name" content="unsurf">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${ogUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogUrl}">
<style>
	:root {
		--ink:        #0a2540;
		--ink-muted:  #425466;
		--ink-soft:   #697386;
		--bg:         #ffffff;
		--canvas:     #f6f9fc;
		--surface:    #ffffff;
		--line:       #e3e8ee;
		--line-soft:  #eef2f7;
		--accent:     #635bff;
		--accent-ink: #ffffff;
		--accent-bg:  #f4f3ff;
		--ok-ink:     #0b6b4f;
		--ok-bg:      #e7f7ee;
		--err-ink:    #a41c1c;
		--err-bg:     #fff4f4;
		--warn-ink:   #7a5b00;
		--warn-bg:    #fff8db;
		--font-sans:  -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, Roboto, sans-serif;
		--font-mono:  ui-monospace, "SF Mono", Menlo, Consolas, monospace;
		--radius:     6px;
		--shadow:     0 1px 2px rgba(10,37,64,0.04), 0 2px 8px rgba(10,37,64,0.04);
	}
	* { box-sizing: border-box; }
	html, body { margin: 0; background: var(--canvas); color: var(--ink); }
	body { font: 14px/1.55 var(--font-sans); -webkit-font-smoothing: antialiased; }
	html[data-embed="1"] header { display: none; }
	html[data-embed="1"] main { padding: 12px; gap: 12px; }
	html[data-embed="1"] { background: transparent; }
	html[data-embed="1"] .panel { box-shadow: none; }
	a { color: var(--accent); text-decoration: none; }
	a:hover { text-decoration: underline; }
	code, .mono { font-family: var(--font-mono); }

	header {
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	.header-inner {
		max-width: 1160px;
		margin: 0 auto;
		padding: 16px 24px;
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.brand {
		font-weight: 600;
		font-size: 15px;
		letter-spacing: -0.01em;
		color: var(--ink);
	}
	.brand .sep { color: var(--line); margin: 0 6px; font-weight: 400; }
	.brand .trace-id {
		font-family: var(--font-mono);
		font-size: 12.5px;
		color: var(--ink-soft);
		font-weight: 400;
		background: var(--canvas);
		padding: 3px 7px;
		border-radius: 4px;
		border: 1px solid var(--line);
	}
	.task {
		color: var(--ink-muted);
		flex: 1;
		min-width: 200px;
		font-size: 14px;
	}
	.actions { display: flex; gap: 8px; flex-wrap: wrap; }
	.actions a, .actions button {
		font: inherit;
		font-size: 12.5px;
		color: var(--ink-muted);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 5px 10px;
		cursor: pointer;
		transition: border-color 120ms, color 120ms;
	}
	.actions a:hover, .actions button:hover {
		text-decoration: none;
		border-color: var(--ink-soft);
		color: var(--ink);
	}

	main {
		max-width: 1160px;
		margin: 0 auto;
		padding: 24px;
		display: grid;
		grid-template-columns: 1fr;
		gap: 20px;
	}
	@media (min-width: 960px) {
		main { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
	}

	.status-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 500;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid transparent;
		line-height: 1.4;
	}
	.pill.ok   { color: var(--ok-ink);   background: var(--ok-bg);   border-color: rgba(11,107,79,0.15); }
	.pill.err  { color: var(--err-ink);  background: var(--err-bg);  border-color: rgba(164,28,28,0.15); }
	.pill.warn { color: var(--warn-ink); background: var(--warn-bg); border-color: rgba(122,91,0,0.15); }
	.pill.priv { color: var(--accent);   background: var(--accent-bg); border-color: rgba(99,91,255,0.15); }
	.pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

	video {
		width: 100%;
		background: #0a2540;
		border-radius: var(--radius);
		aspect-ratio: 16/9;
		box-shadow: var(--shadow);
		display: block;
	}

	.panel {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		overflow: hidden;
	}
	.panel h2 {
		margin: 0;
		padding: 12px 16px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--ink-soft);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-bottom: 1px solid var(--line-soft);
	}
	.panel .body { padding: 4px 0; max-height: 520px; overflow: auto; }

	.steps { list-style: none; margin: 0; padding: 0; }
	.steps li {
		display: grid;
		grid-template-columns: 56px 72px 1fr;
		align-items: start;
		padding: 8px 16px;
		border-bottom: 1px solid var(--line-soft);
		font: 12.5px/1.5 var(--font-mono);
		cursor: pointer;
		background: var(--surface);
		transition: background-color 80ms;
	}
	.steps li:last-child { border-bottom: 0; }
	.steps li:hover { background: var(--canvas); }
	.steps li.active { background: var(--accent-bg); }
	.steps .t { color: var(--ink-soft); text-align: right; padding-right: 12px; }
	.steps .op { color: var(--ink); font-weight: 500; }
	.steps .op.err { color: var(--err-ink); }
	.steps .args { color: var(--ink-muted); word-break: break-word; }
	.steps .step-err {
		grid-column: 2 / 4;
		margin-top: 4px;
		color: var(--err-ink);
		font-size: 12px;
	}

	.meta-grid {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 8px 20px;
		padding: 14px 16px;
		font-size: 13px;
		margin: 0;
	}
	.meta-grid dt { color: var(--ink-soft); font-weight: 500; }
	.meta-grid dd { margin: 0; color: var(--ink); font-family: var(--font-mono); font-size: 12.5px; word-break: break-all; }

	.error-card, .notfound {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 24px;
		box-shadow: var(--shadow);
		color: var(--ink-muted);
	}
	.notfound h3 { margin: 0 0 6px; color: var(--ink); font-size: 16px; }
</style>
</head>
<body>
<header>
	<div class="header-inner">
		<span class="brand">unsurf <span class="sep">∕</span> <span class="trace-id">${id}</span></span>
		<span class="task" id="task">loading…</span>
		<div class="actions">
			<button id="copy" type="button" title="Copy shareable link">Copy link</button>
			<a href="/r/${id}.json${qs}">result.json</a>
			<a href="/r/${id}/trace${qs}">trace.json</a>
			<a href="/r/${id}/meta${qs}">meta.json</a>
		</div>
	</div>
</header>
<main id="main">
	<section>
		<div class="status-row" id="status-row"></div>
		<video id="video" controls preload="metadata"></video>
	</section>
	<aside style="display: grid; gap: 20px; align-content: start;">
		<div class="panel">
			<h2>Steps</h2>
			<div class="body"><ul class="steps" id="steps"></ul></div>
		</div>
		<div class="panel">
			<h2>Metadata</h2>
			<div class="body"><dl class="meta-grid" id="meta"></dl></div>
		</div>
	</aside>
</main>
<script>
(async () => {
	const id = ${JSON.stringify(id)};
	const qs = ${JSON.stringify(qs)};
	const [resultRes, traceRes, metaRes] = await Promise.all([
		fetch(\`/r/\${id}.json\${qs}\`),
		fetch(\`/r/\${id}/trace\${qs}\`),
		fetch(\`/r/\${id}/meta\${qs}\`),
	]);
	if (!resultRes.ok) {
		document.getElementById("task").textContent = "not found";
		document.getElementById("main").innerHTML =
			'<div class="notfound"><h3>Trace not found</h3>This link is invalid, revoked, or expired.</div>';
		return;
	}
	const [result, trace, meta] = await Promise.all([resultRes.json(), traceRes.json(), metaRes.json()]);
	document.getElementById("task").textContent = result.task || "(untitled)";

	const statusRow = document.getElementById("status-row");
	const pill = (cls, label) => {
		const span = document.createElement("span");
		span.className = "pill " + cls;
		const dot = document.createElement("span"); dot.className = "dot";
		span.appendChild(dot);
		span.appendChild(document.createTextNode(" " + label));
		return span;
	};
	if (result.status === "succeeded") {
		statusRow.appendChild(pill("ok", "Succeeded · " + (result.durationMs / 1000).toFixed(1) + "s"));
	} else {
		statusRow.appendChild(pill("err", "Failed: " + (result.error || "unknown error")));
	}
	if (meta.visibility === "private") {
		statusRow.appendChild(pill("priv", "Private"));
	}

	const video = document.getElementById("video");
	const videoRes = await fetch(\`/r/\${id}/video-url\${qs}\`);
	if (videoRes.ok) {
		const { url } = await videoRes.json();
		video.src = url;
	} else {
		video.style.display = "none";
	}

	// Steps: click to seek. We need a reference point for t=0 relative
	// to the video. Trace startedAt is a wall-clock time; the earliest
	// step.t should be ≈0 and we use that as the seek base. Video may
	// have started slightly before or after, so we clamp to valid times.
	const stepsEl = document.getElementById("steps");
	const steps = (trace.steps || []);
	const base = steps.length ? steps[0].t : 0;
	const stepEls = [];
	steps.forEach((s, i) => {
		const li = document.createElement("li");
		li.dataset.t = String(Math.max(0, (s.t - base) / 1000));
		const t = document.createElement("span");
		t.className = "t"; t.textContent = (s.t / 1000).toFixed(2) + "s";
		const op = document.createElement("span");
		op.className = "op" + (s.status === "err" ? " err" : ""); op.textContent = s.op;
		const args = document.createElement("span");
		args.className = "args";
		args.textContent = Object.entries(s.args || {}).map(([k, v]) => k + "=" + JSON.stringify(v)).join(" ");
		li.appendChild(t); li.appendChild(op); li.appendChild(args);
		if (s.error) {
			const e = document.createElement("div");
			e.className = "step-err"; e.textContent = s.error;
			li.appendChild(e);
		}
		li.addEventListener("click", () => {
			if (!video.duration) return;
			const secs = Math.min(video.duration, Math.max(0, Number(li.dataset.t)));
			video.currentTime = secs;
			video.play().catch(() => {});
			stepEls.forEach((el) => el.classList.remove("active"));
			li.classList.add("active");
		});
		stepsEl.appendChild(li);
		stepEls.push(li);
		void i;
	});

	// Auto-highlight the current step as the video plays.
	video.addEventListener("timeupdate", () => {
		let activeIdx = -1;
		for (let i = 0; i < stepEls.length; i++) {
			if (Number(stepEls[i].dataset.t) <= video.currentTime) activeIdx = i; else break;
		}
		stepEls.forEach((el, i) => el.classList.toggle("active", i === activeIdx));
	});

	const metaEl = document.getElementById("meta");
	const row = (k, v) => {
		const dt = document.createElement("dt"); dt.textContent = k;
		const dd = document.createElement("dd"); dd.textContent = v == null ? "—" : String(v);
		metaEl.appendChild(dt); metaEl.appendChild(dd);
	};
	row("id", meta.id);
	row("provider", meta.provider);
	row("harness", meta.harness || "—");
	row("started", new Date(result.startedAt).toLocaleString());
	row("duration", (result.durationMs / 1000).toFixed(2) + "s");
	if (meta.visibility) row("visibility", meta.visibility);
	if (meta.extra) for (const [k, v] of Object.entries(meta.extra)) row(k, v);

	document.getElementById("copy").addEventListener("click", async (e) => {
		try {
			await navigator.clipboard.writeText(location.href);
			const b = e.currentTarget;
			const prev = b.textContent;
			b.textContent = "Copied ✓";
			setTimeout(() => { b.textContent = prev; }, 1400);
		} catch { /* no-op */ }
	});
})();
</script>
</body>
</html>`;
}

// ==================== Ingest ====================

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return hex(digest);
}

export interface AuthResult {
	rateLimitKey: string;
	owner: string;
}

export async function authIngest(
	request: Request,
	env: Pick<Env, "TRACE_TOKENS" | "TRACE_INGEST_TOKEN">,
): Promise<AuthResult | null> {
	const auth = request.headers.get("authorization") || "";
	const m = auth.match(/^Bearer\s+(.+)$/);
	if (!m || !m[1]) return null;
	const token = m[1].trim();
	if (!token) return null;

	// 1. KV-backed per-owner token.
	if (env.TRACE_TOKENS) {
		const hash = await sha256Hex(token);
		const raw = await env.TRACE_TOKENS.get(hash);
		if (raw) {
			try {
				const rec = JSON.parse(raw) as TokenRecord;
				if (!rec.revokedAt) {
					return { rateLimitKey: `t:${hash.slice(0, 16)}`, owner: rec.owner };
				}
			} catch {
				/* treat malformed KV value as no-match; fall through */
			}
		}
	}

	// 2. Legacy single shared token fallback.
	if (env.TRACE_INGEST_TOKEN && token === env.TRACE_INGEST_TOKEN) {
		return { rateLimitKey: "legacy", owner: "legacy" };
	}

	return null;
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
	const authed = await authIngest(request, env);
	if (!authed) return err("unauthorized", 401);

	// Per-token rate limit. 120/min per RateLimit namespace config. If the
	// binding is absent (dev / old deploys) we fail open.
	if (env.TRACE_INGEST_RATE_LIMIT) {
		const { success } = await env.TRACE_INGEST_RATE_LIMIT.limit({ key: authed.rateLimitKey });
		if (!success) return err("rate limit exceeded", 429);
	}

	const cl = Number(request.headers.get("content-length") || "0");
	if (cl > MAX_UPLOAD_BYTES) return err("bundle too large", 413);

	const contentType = request.headers.get("content-type") || "";
	if (!contentType.startsWith("multipart/form-data")) {
		return err("expected multipart/form-data", 415);
	}

	const form = await request.formData();
	const id = String(form.get("id") || "");
	if (!ID_REGEX.test(id)) return err("invalid id", 422);

	const existing = await env.STORAGE.head(r2Key(id, "result"));
	if (existing) return err("id already exists", 409);

	const traceRaw = form.get("trace");
	const resultRaw = form.get("result");
	const metaRaw = form.get("meta");
	const video = form.get("video");

	const isFileLike = (v: unknown): v is { text(): Promise<string>; stream(): ReadableStream } =>
		typeof v === "object" && v !== null && typeof (v as { text?: unknown }).text === "function";

	if (!isFileLike(traceRaw) || !isFileLike(resultRaw) || !isFileLike(metaRaw)) {
		return err("trace/result/meta are required", 422);
	}

	const [traceText, resultText, metaText] = await Promise.all([
		traceRaw.text(),
		resultRaw.text(),
		metaRaw.text(),
	]);

	// Light validation: must parse, must be v0. Also pluck the visibility
	// flag from meta so we can mint an appropriately-scoped viewer grant.
	//
	// Default changed to "private" in v0.4.0 to eliminate the bare-URL
	// footgun. Callers who want a long-lived public share must pass
	// visibility: "public" explicitly — they still get a grant-gated URL,
	// just with a 365-day TTL instead of 7. There is no way from the public
	// API to produce a bare-URL trace anymore.
	let visibility: "public" | "private" = "private";
	for (const [name, text] of [
		["trace", traceText],
		["result", resultText],
		["meta", metaText],
	] as const) {
		try {
			const parsed = JSON.parse(text) as { version?: unknown; id?: unknown; visibility?: unknown };
			if (parsed.version !== "v0") return err(`${name}.version must be "v0"`, 422);
			if (parsed.id !== id) return err(`${name}.id must match form id`, 422);
			if (name === "meta") {
				if (parsed.visibility === "public") visibility = "public";
				else if (parsed.visibility === "private") visibility = "private";
				// Any other value — including undefined — stays "private".
			}
		} catch {
			return err(`${name}.json did not parse`, 422);
		}
	}

	// Always inject visibility + grantGeneration: 0 into stored meta.
	// Overwriting prevents callers from forging generation state; it also
	// makes the stored doc authoritative for enforceVisibility().
	// Inject server-owned fields so search/list endpoints can filter
	// without reading every meta.json. Callers can't forge owner or
	// uploadedAt because we overwrite on write.
	let metaToStore = metaText;
	try {
		const parsed = JSON.parse(metaText) as Record<string, unknown>;
		parsed.visibility = visibility;
		parsed.grantGeneration = 0;
		parsed.owner = authed.owner;
		parsed.uploadedAt = new Date().toISOString();
		metaToStore = JSON.stringify(parsed);
	} catch {
		/* impossible — we just parsed it above, keep original on any edge-case */
	}

	await Promise.all([
		env.STORAGE.put(r2Key(id, "trace"), traceText, {
			httpMetadata: { contentType: "application/json" },
		}),
		env.STORAGE.put(r2Key(id, "result"), resultText, {
			httpMetadata: { contentType: "application/json" },
		}),
		env.STORAGE.put(r2Key(id, "meta"), metaToStore, {
			httpMetadata: { contentType: "application/json" },
		}),
		isFileLike(video)
			? env.STORAGE.put(r2Key(id, "video"), video.stream(), {
					httpMetadata: { contentType: "video/webm" },
				})
			: Promise.resolve(),
	]);

	// Every new trace gets a grant. TTL depends on visibility. The bare
	// `url` field is kept for back-compat but will 404 on its own — callers
	// MUST use `viewerUrl` for new uploads.
	const origin = new URL(request.url).origin;
	const vt = await mintViewerGrant(env, id, 0, grantTtlFor(visibility));
	const q = `?vt=${encodeURIComponent(vt)}`;
	return json({
		id,
		url: `${origin}/r/${id}`,
		viewerUrl: `${origin}/r/${id}${q}`,
		resultUrl: `${origin}/r/${id}.json${q}`,
		videoUrl: isFileLike(video) ? await signVideoUrl(env, origin, id) : undefined,
		visibility,
		owner: authed.owner,
	});
}

// ==================== Token admin ====================
//
// Tiny internal endpoints for minting / revoking ingest tokens. Both require
// the legacy TRACE_INGEST_TOKEN (the "root" token) so we don't have a
// chicken-and-egg on bootstrap. Callers use `unsurf trace-token mint/revoke`
// from the CLI, which posts here.

async function handleTokenMint(request: Request, env: Env): Promise<Response> {
	const auth = request.headers.get("authorization") || "";
	if (!env.TRACE_INGEST_TOKEN || auth !== `Bearer ${env.TRACE_INGEST_TOKEN}`) {
		return err("unauthorized", 401);
	}
	const body = (await request.json().catch(() => null)) as {
		owner?: string;
		scope?: string;
		quotaPerDay?: number;
	} | null;
	if (!body?.owner || typeof body.owner !== "string" || body.owner.length > 64) {
		return err("owner is required (string, <=64 chars)", 422);
	}

	// 32 bytes of randomness, hex-encoded. 64 chars, matches legacy shape.
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const token = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const hash = await sha256Hex(token);
	const record: TokenRecord = {
		owner: body.owner,
		...(body.scope ? { scope: body.scope } : {}),
		...(typeof body.quotaPerDay === "number" ? { quotaPerDay: body.quotaPerDay } : {}),
		createdAt: new Date().toISOString(),
	};
	await env.TRACE_TOKENS.put(hash, JSON.stringify(record));
	return json({ token, owner: record.owner, createdAt: record.createdAt }, 201);
}

async function handleTokenRevoke(request: Request, env: Env): Promise<Response> {
	const auth = request.headers.get("authorization") || "";
	if (!env.TRACE_INGEST_TOKEN || auth !== `Bearer ${env.TRACE_INGEST_TOKEN}`) {
		return err("unauthorized", 401);
	}
	const body = (await request.json().catch(() => null)) as { token?: string } | null;
	if (!body?.token || typeof body.token !== "string") {
		return err("token is required", 422);
	}
	const hash = await sha256Hex(body.token);
	const raw = await env.TRACE_TOKENS.get(hash);
	if (!raw) return err("token not found", 404);
	const rec = JSON.parse(raw) as TokenRecord;
	rec.revokedAt = new Date().toISOString();
	await env.TRACE_TOKENS.put(hash, JSON.stringify(rec));
	return json({ owner: rec.owner, revokedAt: rec.revokedAt });
}

/**
 * Revoke all outstanding viewer grants for a private trace by bumping its
 * `grantGeneration` counter. Previously-issued grants still carry the old
 * generation in their signed payload, so they'll fail the equality check
 * in verifyViewerGrant() on the next request.
 *
 * Response includes a freshly-minted grant so the caller can keep viewing
 * without re-uploading.
 */
async function handleTraceRevoke(request: Request, env: Env, id: string): Promise<Response> {
	const auth = request.headers.get("authorization") || "";
	if (!env.TRACE_INGEST_TOKEN || auth !== `Bearer ${env.TRACE_INGEST_TOKEN}`) {
		return err("unauthorized", 401);
	}
	const existing = await env.STORAGE.get(r2Key(id, "meta"));
	if (!existing) return err("not found", 404);
	let meta: TraceMeta;
	try {
		meta = (await existing.json()) as TraceMeta;
	} catch {
		return err("trace meta unreadable", 500);
	}
	// Both "public" and "private" bundles are grant-gated as of v0.4.0,
	// so both are revocable by bumping the generation counter. Pre-0.4.0
	// grandfathered bundles have no visibility field and nothing to revoke
	// (their access is bare; revoking would require migrating them first).
	if (meta.visibility !== "private" && meta.visibility !== "public") {
		return err("grandfathered bundle has no grants to revoke", 422);
	}
	const prevGen = typeof meta.grantGeneration === "number" ? meta.grantGeneration : 0;
	const nextGen = prevGen + 1;
	meta.grantGeneration = nextGen;
	await env.STORAGE.put(r2Key(id, "meta"), JSON.stringify(meta), {
		httpMetadata: { contentType: "application/json" },
	});
	const vt = await mintViewerGrant(env, id, nextGen, grantTtlFor(meta.visibility));
	const origin = new URL(request.url).origin;
	return json({
		id,
		revokedGeneration: prevGen,
		grantGeneration: nextGen,
		viewerUrl: `${origin}/r/${id}?vt=${encodeURIComponent(vt)}`,
	});
}

// ==================== Search ====================
//
// Lists recent trace metadata. Filters by owner (defaulting to the caller's
// own, root token excepted), optional task substring, optional visibility.
// Paginates over R2 via listOpts.cursor. Returns at most 100 entries/call.
//
// Why filter in the worker: listing R2 by `trace/*/meta.json` is fast, and
// we have ≤ a few thousand bundles total today. When that stops scaling,
// fold this into D1 on upload. Not premature now.

const SEARCH_MAX_LIMIT = 100;
const SEARCH_DEFAULT_LIMIT = 25;
const SEARCH_SCAN_BUDGET = 400; // R2 objects to fetch before we return a cursor

interface SearchEntry {
	id: string;
	task: string;
	owner: string;
	harness?: string;
	visibility: "public" | "private" | "grandfathered";
	uploadedAt?: string;
	provider?: string;
	viewerUrl?: string;
}

async function handleSearch(
	request: Request,
	env: Env,
	searchParams: URLSearchParams,
): Promise<Response> {
	const authed = await authIngest(request, env);
	if (!authed) return err("unauthorized", 401);

	const ownerFilter = searchParams.get("owner") || undefined;
	const qRaw = searchParams.get("q") || "";
	const q = qRaw.toLowerCase().trim();
	const visFilter = searchParams.get("visibility");
	const limit = Math.min(
		SEARCH_MAX_LIMIT,
		Math.max(1, Number(searchParams.get("limit") || SEARCH_DEFAULT_LIMIT)),
	);
	const cursor = searchParams.get("cursor") || undefined;

	// Scope rule: root (legacy) token sees any owner (ownerFilter respected).
	// Per-owner tokens are always scoped to their own owner, ignoring any
	// `owner=<other>` param in the query string. This prevents data leakage
	// via the search API.
	const effectiveOwner = authed.owner === "legacy" ? ownerFilter : authed.owner;

	const list = await env.STORAGE.list({
		prefix: "trace/",
		limit: SEARCH_SCAN_BUDGET,
		...(cursor ? { cursor } : {}),
	});

	const metaKeys = list.objects.filter((o) => o.key.endsWith("/meta.json")).map((o) => o.key);

	const entries: SearchEntry[] = [];
	await Promise.all(
		metaKeys.map(async (key) => {
			const idMatch = key.match(/^trace\/([0-9a-z]{12})\/meta\.json$/);
			if (!idMatch) return;
			const id = idMatch[1]!;
			const obj = await env.STORAGE.get(key);
			if (!obj) return;
			const meta = (await obj.json().catch(() => null)) as
				| (TraceMeta & {
						task?: string;
						owner?: string;
						harness?: string;
						uploadedAt?: string;
						provider?: string;
				  })
				| null;
			if (!meta) return;

			const owner = typeof meta.owner === "string" ? meta.owner : "unknown";
			if (effectiveOwner && owner !== effectiveOwner) return;

			const visibility: SearchEntry["visibility"] =
				meta.visibility === "public" || meta.visibility === "private"
					? meta.visibility
					: "grandfathered";
			if (visFilter && visFilter !== visibility) return;

			const task = typeof meta.task === "string" ? meta.task : "";
			if (q && !task.toLowerCase().includes(q)) return;

			const entry: SearchEntry = {
				id,
				task,
				owner,
				visibility,
				...(typeof meta.harness === "string" ? { harness: meta.harness } : {}),
				...(typeof meta.uploadedAt === "string" ? { uploadedAt: meta.uploadedAt } : {}),
				...(typeof meta.provider === "string" ? { provider: meta.provider } : {}),
			};

			// For grant-gated bundles, mint a fresh grant so the caller can
			// open the result without a separate round-trip. Grandfathered
			// bundles get the bare URL.
			const origin = new URL(request.url).origin;
			if (visibility === "grandfathered") {
				entry.viewerUrl = `${origin}/r/${id}`;
			} else {
				const gen = typeof meta.grantGeneration === "number" ? meta.grantGeneration : 0;
				const vt = await mintViewerGrant(env, id, gen, grantTtlFor(visibility));
				entry.viewerUrl = `${origin}/r/${id}?vt=${encodeURIComponent(vt)}`;
			}

			entries.push(entry);
		}),
	);

	// Sort newest first by uploadedAt (grandfathered fall to end).
	entries.sort((a, b) => {
		if (!a.uploadedAt && !b.uploadedAt) return 0;
		if (!a.uploadedAt) return 1;
		if (!b.uploadedAt) return -1;
		return b.uploadedAt.localeCompare(a.uploadedAt);
	});

	const clipped = entries.slice(0, limit);
	const nextCursor = list.truncated ? list.cursor : undefined;
	return json(
		{
			entries: clipped,
			count: clipped.length,
			scannedObjects: list.objects.length,
			nextCursor,
			owner: effectiveOwner ?? "(all)",
		},
		200,
	);
}

// ==================== Fetch handler ====================

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const { pathname, searchParams } = url;
		const method = request.method;

		// CORS for JSON fetch() from viewer.
		const cors: HeadersInit = {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET, POST, OPTIONS",
			"access-control-allow-headers": "authorization, content-type",
		};
		if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

		// POST /upload — ingest.
		if (method === "POST" && pathname === "/upload") {
			const res = await handleUpload(request, env);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v as string);
			return res;
		}

		// POST /admin/tokens — mint a new ingest token (requires root token).
		if (method === "POST" && pathname === "/admin/tokens") {
			const res = await handleTokenMint(request, env);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v as string);
			return res;
		}

		// POST /admin/tokens/revoke — revoke a token.
		if (method === "POST" && pathname === "/admin/tokens/revoke") {
			const res = await handleTokenRevoke(request, env);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v as string);
			return res;
		}

		// POST /admin/traces/:id/revoke — revoke outstanding viewer grants.
		const traceRevokeMatch = pathname.match(/^\/admin\/traces\/([0-9a-z]{12})\/revoke$/);
		if (method === "POST" && traceRevokeMatch && traceRevokeMatch[1]) {
			const res = await handleTraceRevoke(request, env, traceRevokeMatch[1]);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v as string);
			return res;
		}

		// GET /healthz — liveness.
		if (method === "GET" && pathname === "/healthz") {
			return json({ ok: true, service: "unsurf-trace" }, 200, cors);
		}

		// GET /search?owner=<name>&q=<substr>&visibility=<v>&limit=50
		//   Requires Bearer auth (same token matrix as /upload).
		//   Per-owner tokens can only see their own traces.
		//   Root (legacy) token sees everything.
		if (method === "GET" && pathname === "/search") {
			const res = await handleSearch(request, env, searchParams);
			for (const [k, v] of Object.entries(cors)) res.headers.set(k, v as string);
			return res;
		}

		// GET / — index pointer to docs.
		if (method === "GET" && pathname === "/") {
			return new Response(
				`<!doctype html><meta charset=utf-8><title>unsurf trace</title>
<style>body{font:14px/1.5 -apple-system,sans-serif;max-width:560px;margin:4rem auto;padding:0 1rem;color:#e6e8eb;background:#0b0c10}a{color:#7cc4ff}code{background:#1b1d22;padding:2px 6px;border-radius:3px}</style>
<h1>unsurf trace</h1>
<p>Recordings from the unsurf <code>record</code> skill. Visit <code>/r/:id</code> for a specific trace.</p>
<p><a href="https://github.com/acoyfellow/unsurf#trace">Docs →</a></p>`,
				{ status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
			);
		}

		// Everything else is /r/:id/...
		const m = pathname.match(
			/^\/r\/([0-9a-z]{12})(\.json|\/trace|\/meta|\/video\.webm|\/video-url|\/og\.svg)?$/,
		);
		if (!m || !m[1]) return err("not found", 404);
		const id = m[1];
		const suffix = m[2] ?? "";

		// Every /r/:id* path is gated by visibility. Private traces require
		// a signed ?vt=<grant> on every request; missing or bad grant → 404
		// (existence intentionally not leaked).
		const gate = await enforceVisibility(request, env, id, searchParams);
		if (gate) return gate;

		// GET /r/:id — HTML viewer.
		if (method === "GET" && suffix === "") {
			const vt = searchParams.get("vt") || "";
			const embed = searchParams.get("embed") === "1";
			return new Response(viewerHtml(id, url.origin, vt, embed), {
				status: 200,
				headers: {
					"content-type": "text/html; charset=utf-8",
					// Private traces must not be cached by shared proxies.
					"cache-control": vt ? "private, no-store" : "public, max-age=3600",
					...cors,
				},
			});
		}

		// GET /r/:id.json — receipt.
		if (method === "GET" && suffix === ".json") {
			const obj = await env.STORAGE.get(r2Key(id, "result"));
			if (!obj) return err("not found", 404);
			return new Response(obj.body, { status: 200, headers: { ...JSON_HEADERS, ...cors } });
		}

		// GET /r/:id/trace — trace.json.
		if (method === "GET" && suffix === "/trace") {
			const obj = await env.STORAGE.get(r2Key(id, "trace"));
			if (!obj) return err("not found", 404);
			return new Response(obj.body, { status: 200, headers: { ...JSON_HEADERS, ...cors } });
		}

		// GET /r/:id/meta — meta.json.
		if (method === "GET" && suffix === "/meta") {
			const obj = await env.STORAGE.get(r2Key(id, "meta"));
			if (!obj) return err("not found", 404);
			return new Response(obj.body, { status: 200, headers: { ...JSON_HEADERS, ...cors } });
		}

		// GET /r/:id/video-url — mint a fresh signed URL (viewer uses this).
		if (method === "GET" && suffix === "/video-url") {
			const exists = await env.STORAGE.head(r2Key(id, "video"));
			if (!exists) return err("no video", 404);
			const signed = await signVideoUrl(env, url.origin, id);
			return json({ url: signed }, 200, cors);
		}

		// GET /r/:id/og.svg — 1200x630 SVG social card. Shared links in
		// Slack/Twitter/etc. preview with the trace task + id.
		if (method === "GET" && suffix === "/og.svg") {
			const resultObj = await env.STORAGE.get(r2Key(id, "result"));
			if (!resultObj) return err("not found", 404);
			let task = "trace";
			let status: "succeeded" | "failed" = "succeeded";
			let durationMs = 0;
			try {
				const r = (await resultObj.json()) as {
					task?: string;
					status?: string;
					durationMs?: number;
				};
				if (typeof r.task === "string") task = r.task;
				if (r.status === "failed") status = "failed";
				if (typeof r.durationMs === "number") durationMs = r.durationMs;
			} catch {
				/* best-effort */
			}
			return new Response(ogSvg(id, task, status, durationMs), {
				status: 200,
				headers: {
					"content-type": "image/svg+xml; charset=utf-8",
					"cache-control": "public, max-age=3600",
					...cors,
				},
			});
		}

		// GET /r/:id/video.webm?exp=&sig= — signed playback.
		if (method === "GET" && suffix === "/video.webm") {
			const exp = Number(searchParams.get("exp") || "0");
			const sig = searchParams.get("sig") || "";
			if (!exp || !sig) return err("signature required", 401);
			if (exp < Math.floor(Date.now() / 1000)) return err("signature expired", 401);
			const key = await importSigningKey(env.TRACE_SIGNING_KEY);
			const ok = await verify(key, `${id}|${exp}`, sig);
			if (!ok) return err("bad signature", 401);
			const obj = await env.STORAGE.get(r2Key(id, "video"));
			if (!obj) return err("not found", 404);
			return new Response(obj.body, {
				status: 200,
				headers: {
					"content-type": "video/webm",
					"cache-control": "public, max-age=300",
					"accept-ranges": "bytes",
				},
			});
		}

		return err("not found", 404);
	},
};
