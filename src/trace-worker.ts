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
 *   STORAGE             R2 bucket (shared with the main unsurf worker; trace/
 *                        prefix keys every object)
 *   TRACE_SIGNING_KEY   32-byte hex string, HMAC key for signed video URLs
 *   TRACE_INGEST_TOKEN  bearer token required on POST /upload
 *
 * Bundle layout in R2 (see src/skills/record/SPEC.md):
 *   trace/<id>.webm
 *   trace/<id>/trace.json
 *   trace/<id>/result.json
 *   trace/<id>/meta.json
 */

interface Env {
	STORAGE: R2Bucket;
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

// ==================== Viewer HTML ====================

function viewerHtml(id: string, origin: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>trace ${id} — unsurf</title>
<style>
	:root { color-scheme: dark light; }
	* { box-sizing: border-box; }
	body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #0b0c10; color: #e6e8eb; }
	header { padding: 16px 20px; border-bottom: 1px solid #222; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
	header h1 { margin: 0; font-size: 14px; font-weight: 500; }
	header h1 code { background: #1b1d22; padding: 2px 6px; border-radius: 3px; color: #7cc4ff; }
	header .task { color: #9aa3ad; flex: 1; min-width: 200px; }
	header a { color: #7cc4ff; text-decoration: none; font-size: 12px; }
	header a:hover { text-decoration: underline; }
	main { max-width: 1100px; margin: 0 auto; padding: 20px; display: grid; grid-template-columns: 1fr; gap: 20px; }
	@media (min-width: 900px) { main { grid-template-columns: 1.3fr 1fr; } }
	video { width: 100%; background: #000; border-radius: 4px; aspect-ratio: 16/10; }
	.panel { background: #12141a; border: 1px solid #1f222a; border-radius: 4px; overflow: hidden; }
	.panel h2 { margin: 0; padding: 10px 14px; font-size: 12px; font-weight: 500; color: #9aa3ad; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #1f222a; background: #0e1014; }
	.panel .body { padding: 10px 14px; max-height: 520px; overflow: auto; }
	pre { margin: 0; font: 12px/1.55 "SF Mono", Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; color: #c8cdd4; }
	.steps li { list-style: none; padding: 6px 0; border-bottom: 1px dashed #1f222a; display: flex; gap: 10px; font: 12px/1.4 "SF Mono", Menlo, Consolas, monospace; }
	.steps li:last-child { border-bottom: 0; }
	.steps .t { color: #6b737d; min-width: 52px; text-align: right; }
	.steps .op { color: #7cc4ff; min-width: 70px; }
	.steps .args { color: #c8cdd4; flex: 1; word-break: break-word; }
	.steps .ok { color: #4ade80; }
	.steps .err { color: #f87171; }
	.meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; }
	.meta-grid dt { color: #6b737d; }
	.meta-grid dd { margin: 0; }
	.muted { color: #6b737d; font-size: 11px; }
	.banner { padding: 8px 14px; background: #2a1010; color: #f87171; font-size: 12px; }
	.ok-banner { padding: 8px 14px; background: #0e2218; color: #4ade80; font-size: 12px; }
</style>
</head>
<body>
<header>
	<h1><code>trace/${id}</code></h1>
	<span class="task" id="task">loading…</span>
	<a href="/r/${id}.json">result.json</a>
	<a href="/r/${id}/trace">trace.json</a>
	<a href="/r/${id}/meta">meta.json</a>
</header>
<main>
	<div>
		<video id="video" controls preload="metadata"></video>
		<div id="status" class="muted" style="margin-top: 8px;"></div>
	</div>
	<div style="display: grid; gap: 16px; align-content: start;">
		<div class="panel">
			<h2>Steps</h2>
			<div class="body"><ul class="steps" id="steps"></ul></div>
		</div>
		<div class="panel">
			<h2>Meta</h2>
			<div class="body"><dl class="meta-grid" id="meta"></dl></div>
		</div>
	</div>
</main>
<script>
(async () => {
	const id = ${JSON.stringify(id)};
	const origin = ${JSON.stringify(origin)};
	const [resultRes, traceRes, metaRes] = await Promise.all([
		fetch(\`/r/\${id}.json\`),
		fetch(\`/r/\${id}/trace\`),
		fetch(\`/r/\${id}/meta\`),
	]);
	if (!resultRes.ok) {
		document.getElementById("task").textContent = "not found";
		document.getElementById("status").innerHTML = '<div class="banner">This trace does not exist or has expired.</div>';
		return;
	}
	const [result, trace, meta] = await Promise.all([resultRes.json(), traceRes.json(), metaRes.json()]);
	document.getElementById("task").textContent = result.task || "(untitled)";
	const statusBanner = result.status === "succeeded"
		? \`<div class="ok-banner">succeeded in \${(result.durationMs / 1000).toFixed(1)}s</div>\`
		: \`<div class="banner">failed: \${result.error || "unknown error"}</div>\`;
	document.getElementById("status").innerHTML = statusBanner;

	// Video is signed; fetch a fresh URL.
	const videoRes = await fetch(\`/r/\${id}/video-url\`);
	if (videoRes.ok) {
		const { url } = await videoRes.json();
		document.getElementById("video").src = url;
	} else {
		document.getElementById("video").style.display = "none";
	}

	const stepsEl = document.getElementById("steps");
	for (const s of trace.steps || []) {
		const li = document.createElement("li");
		const args = Object.entries(s.args || {}).map(([k, v]) => \`\${k}=\${JSON.stringify(v)}\`).join(" ");
		li.innerHTML = \`<span class="t">\${s.t}ms</span><span class="op \${s.status}">\${s.op}</span><span class="args">\${args}\${s.error ? \` <span class="err">\${s.error}</span>\` : ""}</span>\`;
		stepsEl.appendChild(li);
	}

	const metaEl = document.getElementById("meta");
	const rows = [
		["id", meta.id],
		["provider", meta.provider],
		["harness", meta.harness || "—"],
		["started", new Date(result.startedAt).toLocaleString()],
		["duration", \`\${(result.durationMs / 1000).toFixed(2)}s\`],
	];
	for (const [k, v] of rows) {
		const dt = document.createElement("dt"); dt.textContent = k;
		const dd = document.createElement("dd"); dd.textContent = v;
		metaEl.appendChild(dt); metaEl.appendChild(dd);
	}
	if (meta.extra) {
		for (const [k, v] of Object.entries(meta.extra)) {
			const dt = document.createElement("dt"); dt.textContent = k;
			const dd = document.createElement("dd"); dd.textContent = String(v);
			metaEl.appendChild(dt); metaEl.appendChild(dd);
		}
	}
})();
</script>
</body>
</html>`;
}

// ==================== Ingest ====================

async function handleUpload(request: Request, env: Env): Promise<Response> {
	const auth = request.headers.get("authorization") || "";
	const expected = `Bearer ${env.TRACE_INGEST_TOKEN}`;
	if (!env.TRACE_INGEST_TOKEN || auth !== expected) {
		return err("unauthorized", 401);
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

	// Light validation: must parse, must be v0.
	for (const [name, text] of [
		["trace", traceText],
		["result", resultText],
		["meta", metaText],
	] as const) {
		try {
			const parsed = JSON.parse(text);
			if (parsed.version !== "v0") return err(`${name}.version must be "v0"`, 422);
			if (parsed.id !== id) return err(`${name}.id must match form id`, 422);
		} catch {
			return err(`${name}.json did not parse`, 422);
		}
	}

	await Promise.all([
		env.STORAGE.put(r2Key(id, "trace"), traceText, {
			httpMetadata: { contentType: "application/json" },
		}),
		env.STORAGE.put(r2Key(id, "result"), resultText, {
			httpMetadata: { contentType: "application/json" },
		}),
		env.STORAGE.put(r2Key(id, "meta"), metaText, {
			httpMetadata: { contentType: "application/json" },
		}),
		isFileLike(video)
			? env.STORAGE.put(r2Key(id, "video"), video.stream(), {
					httpMetadata: { contentType: "video/webm" },
				})
			: Promise.resolve(),
	]);

	const origin = new URL(request.url).origin;
	return json({
		id,
		url: `${origin}/r/${id}`,
		resultUrl: `${origin}/r/${id}.json`,
		videoUrl: isFileLike(video) ? await signVideoUrl(env, origin, id) : undefined,
	});
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

		// GET /healthz — liveness.
		if (method === "GET" && pathname === "/healthz") {
			return json({ ok: true, service: "unsurf-trace" }, 200, cors);
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
			/^\/r\/([0-9a-z]{12})(\.json|\/trace|\/meta|\/video\.webm|\/video-url)?$/,
		);
		if (!m || !m[1]) return err("not found", 404);
		const id = m[1];
		const suffix = m[2] ?? "";

		// GET /r/:id — HTML viewer.
		if (method === "GET" && suffix === "") {
			// Cheap existence check so 404s are not HTML-disguised.
			const exists = await env.STORAGE.head(r2Key(id, "result"));
			if (!exists) return err("not found", 404);
			return new Response(viewerHtml(id, url.origin), {
				status: 200,
				headers: {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "public, max-age=3600",
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
