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
import { Gallery, KvCache, KvCacheLive, makeD1Gallery, makeKvCache } from "./services/Gallery.js";
import { OpenApiGenerator, makeOpenApiGenerator } from "./services/OpenApiGenerator.js";
import { SchemaInferrer, makeSchemaInferrer } from "./services/SchemaInferrer.js";
import { Store, StoreD1Live, makeD1Store } from "./services/Store.js";
import { heal } from "./tools/Heal.js";
import { scout } from "./tools/Scout.js";
import { worker } from "./tools/Worker.js";
import { directoryHtml } from "./ui/directoryHtml.js";

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
	const { url, task, publish } = body as { url: string; task: string; publish?: boolean };
	if (!url || !task) {
		return errorResponse("Missing 'url' and 'task' in request body", 400);
	}

	const result = await Effect.runPromise(
		scout({ url, task, publish }).pipe(Effect.provide(buildLayer(env))),
	);

	return jsonResponse(result);
}

async function handleWorker(body: unknown, env: Env): Promise<Response> {
	const { pathId, data, headers } = body as {
		pathId: string;
		data?: Record<string, unknown>;
		headers?: Record<string, string>;
	};
	if (!pathId) {
		return errorResponse("Missing 'pathId' in request body", 400);
	}

	const layer = Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);

	const result = await Effect.runPromise(
		worker({ pathId, data, headers }).pipe(Effect.provide(layer)),
	);

	return jsonResponse(result);
}

async function handleHeal(body: unknown, env: Env): Promise<Response> {
	const { pathId, error } = body as { pathId: string; error?: string };
	if (!pathId) {
		return errorResponse("Missing 'pathId' in request body", 400);
	}

	const result = await Effect.runPromise(
		heal({ pathId, error }).pipe(Effect.provide(buildLayer(env))),
	);

	return jsonResponse(result);
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

		// Directory UI (homepage)
		if (url.pathname === "/" || url.pathname === "/directory") {
			return new Response(directoryHtml, {
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					...corsHeaders(),
				},
			});
		}

		// API info endpoint
		if (url.pathname === "/api") {
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

		// MCP endpoint
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
				if (message.includes("NotFoundError")) return errorResponse(message, 404);
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
