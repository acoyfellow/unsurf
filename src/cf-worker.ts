import type { BrowserWorker } from "@cloudflare/puppeteer";
/**
 * unsurf — Turn any website into a typed API
 *
 * Cloudflare Worker entry point
 */
import { Effect, Layer } from "effect";
import { createDb } from "./db/queries.js";
import { handleMcpRequest } from "./mcp.js";
import { BrowserCfLive } from "./services/Browser.js";
import { type Capability, Directory, makeD1Directory } from "./services/Directory.js";
import { Gallery, makeD1Gallery, makeKvCache } from "./services/Gallery.js";
import { makeOpenApiGenerator, OpenApiGenerator } from "./services/OpenApiGenerator.js";
import { makeSchemaInferrer, SchemaInferrer } from "./services/SchemaInferrer.js";
import { makeD1Store, StoreD1Live } from "./services/Store.js";
import { heal } from "./tools/Heal.js";
import { scout } from "./tools/Scout.js";
import { worker } from "./tools/Worker.js";

interface Env {
	DB: D1Database;
	STORAGE: R2Bucket;
	BROWSER: BrowserWorker;
	CACHE?: KVNamespace | undefined;
	VECTORS?: VectorizeIndex | undefined;
	AI?: Ai | undefined;
	ANTHROPIC_API_KEY?: string | undefined;
}

// ==================== Helpers ====================

function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(),
		},
	});
}

function errorResponse(message: string, status = 500): Response {
	return jsonResponse({ error: message }, status);
}

// ==================== Runtime Layer ====================

function buildLayer(env: Env) {
	const storeService = makeD1Store(createDb(env.DB), env.STORAGE);
	const kvCache = env.CACHE ? makeKvCache(env.CACHE) : undefined;

	const baseLayers = [
		StoreD1Live(env.DB, env.STORAGE),
		BrowserCfLive(env.BROWSER),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
		Layer.succeed(Gallery, makeD1Gallery(env.DB, storeService, kvCache)),
	] as const;

	// Include Directory service when VECTORS + AI bindings are available
	// so that scout with publish:true auto-publishes to the directory
	if (env.VECTORS && env.AI) {
		return Layer.mergeAll(
			...baseLayers,
			Layer.succeed(Directory, makeD1Directory(env.DB, env.STORAGE, env.VECTORS, env.AI)),
		);
	}

	return Layer.mergeAll(...baseLayers);
}

// ==================== Gallery Helpers ====================

function buildGalleryService(env: Env) {
	const storeService = makeD1Store(createDb(env.DB), env.STORAGE);
	const kvCache = env.CACHE ? makeKvCache(env.CACHE) : undefined;
	return makeD1Gallery(env.DB, storeService, kvCache);
}

// ==================== Directory Helpers ====================

function buildDirectoryService(env: Env) {
	if (!env.VECTORS || !env.AI) {
		throw new Error("Directory requires VECTORS and AI bindings");
	}
	return makeD1Directory(env.DB, env.STORAGE, env.VECTORS, env.AI);
}

async function handleGallerySearch(url: URL, env: Env): Promise<Response> {
	const q = url.searchParams.get("q") ?? undefined;
	const domain = url.searchParams.get("domain") ?? undefined;
	const limitParam = url.searchParams.get("limit");
	const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

	if (!q && !domain) {
		return errorResponse("At least one of 'q' or 'domain' must be provided", 400);
	}

	const gallery = buildGalleryService(env);
	const results = await Effect.runPromise(gallery.search(q ?? "", domain, limit));
	return jsonResponse({ results, total: results.length });
}

async function handleGallerySpec(id: string, env: Env): Promise<Response> {
	const gallery = buildGalleryService(env);
	const spec = await Effect.runPromise(gallery.getSpec(id));
	return jsonResponse(spec);
}

async function handleGalleryPublish(body: unknown, env: Env): Promise<Response> {
	const { siteId, contributor } = body as { siteId: string; contributor?: string };
	if (!siteId) {
		return errorResponse("Missing 'siteId' in request body", 400);
	}

	const gallery = buildGalleryService(env);
	const entry = await Effect.runPromise(gallery.publish(siteId, contributor));
	return jsonResponse(entry);
}

// ==================== Route Handlers ====================

async function handleScout(body: unknown, env: Env): Promise<Response> {
	const { url, task, publish, force } = body as {
		url: string;
		task: string;
		publish?: boolean;
		force?: boolean;
	};
	if (!url || !task) {
		return errorResponse("Missing 'url' and 'task' in request body", 400);
	}

	const result = await Effect.runPromise(
		scout({ url, task, publish, force }).pipe(Effect.provide(buildLayer(env))),
	);

	return jsonResponse(result);
}

async function handleWorker(body: unknown, env: Env): Promise<Response> {
	const { pathId, data, headers, confirmUnsafe } = body as {
		pathId: string;
		data?: Record<string, unknown>;
		headers?: Record<string, string>;
		confirmUnsafe?: boolean;
	};
	if (!pathId) {
		return errorResponse("Missing 'pathId' in request body", 400);
	}

	const layer = Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);

	try {
		const result = await Effect.runPromise(
			worker({ pathId, data, headers, confirmUnsafe }).pipe(Effect.provide(layer)),
		);
		return jsonResponse(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes('"resource"')) return errorResponse(message, 404);
		if (message.includes("BlockedDomainError")) return errorResponse(message, 403);
		return errorResponse(message);
	}
}

async function handleHeal(body: unknown, env: Env): Promise<Response> {
	const { pathId, error } = body as { pathId: string; error?: string };
	if (!pathId) {
		return errorResponse("Missing 'pathId' in request body", 400);
	}

	try {
		const result = await Effect.runPromise(
			heal({ pathId, error }).pipe(Effect.provide(buildLayer(env))),
		);
		return jsonResponse(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes('"resource"')) return errorResponse(message, 404);
		if (message.includes("BlockedDomainError")) return errorResponse(message, 403);
		return errorResponse(message);
	}
}

// ==================== Entry Point ====================

export default {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: routing dispatch, each branch is simple
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders() });
		}

		// Root + /api: REST discovery
		if (url.pathname === "/" || url.pathname === "/api") {
			return jsonResponse({
				name: "unsurf",
				version: "0.3.0",
				description: "The typed internet — a machine-readable directory of every API",
				directory: {
					fingerprint: "/d/:domain",
					capability: "/d/:domain/:capability",
					endpoint: "/d/:domain/:method/:path",
					spec: "/d/:domain/spec",
					search: "/search?q=:query",
					publish: "POST /d/publish",
				},
				tools: ["scout", "worker", "heal"],
				mcp: "/mcp",
				docs: "https://unsurf.coey.dev",
			});
		}

		// MCP
		if (url.pathname === "/mcp") {
			return handleMcpRequest(request, env);
		}

		// Directory routes (/d/:domain, /d/:domain/:capability, /d/:domain/:method/:path, /d/:domain/spec)
		// Validate endpoints for a domain (must be before general /d/ handler)
		if (url.pathname === "/d/validate" && request.method === "POST") {
			try {
				const { validateSite } = await import("./lib/validate.js");
				const body = (await request.json()) as {
					domain: string;
					endpoints: Array<{ method: string; path: string }>;
				};
				if (!body.domain || !body.endpoints) {
					return errorResponse("Missing 'domain' or 'endpoints' in body", 400);
				}
				const result = await validateSite(body.domain, body.endpoints);
				return jsonResponse(result);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return errorResponse(message);
			}
		}

		// Invoke endpoint (dogfooding — try an API call from directory UI)
		if (url.pathname === "/d/invoke" && request.method === "POST") {
			try {
				const body = (await request.json()) as {
					domain: string;
					method: string;
					path: string;
					body?: unknown;
				};
				if (!body.domain || !body.method || !body.path) {
					return errorResponse("Missing domain, method, or path", 400);
				}
				// Resolve path params (:id or {id} → 1) for demo
				const resolvedPath = body.path.replace(/\/:[\w-]+/g, "/1").replace(/\/\{[\w-]+\}/g, "/1");
				const targetUrl = `https://${body.domain}${resolvedPath}`;
				const init: RequestInit = {
					method: body.method,
					headers: { Accept: "application/json" },
				};
				if (body.body && ["POST", "PUT", "PATCH"].includes(body.method.toUpperCase())) {
					init.headers = {
						...init.headers,
						"Content-Type": "application/json",
					} as HeadersInit;
					init.body = JSON.stringify(body.body);
				}
				const res = await fetch(targetUrl, init);
				const text = await res.text();
				let json: unknown;
				try {
					json = JSON.parse(text);
				} catch {
					json = text;
				}
				return jsonResponse({
					status: res.status,
					ok: res.ok,
					body: json,
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return errorResponse(message);
			}
		}

		// Publish to directory (must be before general /d/ handler)
		if (url.pathname === "/d/publish" && request.method === "POST") {
			try {
				if (!env.VECTORS || !env.AI) {
					return errorResponse("Directory not configured (requires VECTORS + AI bindings)", 503);
				}
				const body = (await request.json()) as { siteId: string; contributor?: string };
				if (!body.siteId) return errorResponse("Missing 'siteId' in body", 400);
				const directory = buildDirectoryService(env);
				const fp = await Effect.runPromise(directory.publish(body.siteId, body.contributor));
				return jsonResponse(fp);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return errorResponse(message);
			}
		}

		if (url.pathname.startsWith("/d/")) {
			// Directory lookup routes are GET-only (POST /d/invoke, /d/publish, etc. handled above)
			if (request.method !== "GET" && request.method !== "DELETE") {
				return errorResponse("Not found", 404);
			}
			try {
				if (!env.VECTORS || !env.AI) {
					return errorResponse("Directory not configured (requires VECTORS + AI bindings)", 503);
				}
				const directory = buildDirectoryService(env);
				const parts = url.pathname.slice(3).split("/").filter(Boolean);

				// DELETE /d/:domain - remove from directory
				if (request.method === "DELETE" && parts.length === 1) {
					const domain = parts[0] ?? "";
					await Effect.runPromise(directory.delete(domain));
					return jsonResponse({ deleted: domain });
				}

				if (parts.length === 0) {
					// GET /d/ - list all
					const offset = Number(url.searchParams.get("offset") || 0);
					const limit = Number(url.searchParams.get("limit") || 20);
					const results = await Effect.runPromise(directory.list(offset, limit));
					return jsonResponse({ fingerprints: results, count: results.length });
				}

				const domain = parts[0] ?? "";

				if (parts.length === 1) {
					// GET /d/:domain - fingerprint
					const fp = await Effect.runPromise(directory.getFingerprint(domain));
					return jsonResponse(fp);
				}

				if (parts[1] === "spec") {
					// GET /d/:domain/spec - full OpenAPI
					const spec = await Effect.runPromise(directory.getSpec(domain));
					return jsonResponse(spec);
				}

				if (parts.length === 2) {
					// GET /d/:domain/:capability - capability slice
					const cap = (parts[1] ?? "") as Capability;
					const slice = await Effect.runPromise(directory.getCapabilitySlice(domain, cap));
					return jsonResponse(slice);
				}

				if (parts.length >= 3) {
					// GET /d/:domain/:method/:path - single endpoint
					const method = parts[1] ?? "";
					const path = `/${parts.slice(2).join("/")}`;
					const endpoint = await Effect.runPromise(directory.getEndpoint(domain, method, path));
					return jsonResponse(endpoint);
				}

				return errorResponse("Invalid directory path", 400);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				if (message.includes('"resource"')) return errorResponse(message, 404);
				return errorResponse(message);
			}
		}

		// Search endpoint
		if (url.pathname === "/search" && request.method === "GET") {
			try {
				if (!env.VECTORS || !env.AI) {
					return errorResponse("Search not configured (requires VECTORS + AI bindings)", 503);
				}
				const q = url.searchParams.get("q");
				if (!q) return errorResponse("Missing 'q' query parameter", 400);
				const limit = Number(url.searchParams.get("limit") || 10);
				const directory = buildDirectoryService(env);
				const results = await Effect.runPromise(directory.search(q, limit));
				return jsonResponse({ results, total: results.length });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return errorResponse(message);
			}
		}

		// Gallery routes (legacy)
		if (url.pathname.startsWith("/gallery")) {
			try {
				if (request.method === "GET" && url.pathname === "/gallery") {
					return await handleGallerySearch(url, env);
				}
				// Match /gallery/:id/spec
				const specMatch = url.pathname.match(/^\/gallery\/([^/]+)\/spec$/);
				const specId = specMatch?.[1];
				if (request.method === "GET" && specId) {
					return await handleGallerySpec(specId, env);
				}
				if (request.method === "POST" && url.pathname === "/gallery/publish") {
					const body = await request.json();
					return await handleGalleryPublish(body, env);
				}
				return errorResponse("Not found", 404);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return errorResponse(message);
			}
		}

		// Tool routes (REST API)
		if (request.method === "POST" && url.pathname.startsWith("/tools/")) {
			try {
				const body = await request.json();

				switch (url.pathname) {
					case "/tools/scout":
						return await handleScout(body, env);
					case "/tools/worker":
						return await handleWorker(body, env);
					case "/tools/heal":
						return await handleHeal(body, env);
					default:
						return errorResponse(`Unknown tool: ${url.pathname}`, 404);
				}
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return errorResponse(message);
			}
		}

		return errorResponse("Not found", 404);
	},
};
