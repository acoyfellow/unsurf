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
import { Gallery, KvCache, KvCacheLive, makeD1Gallery, makeKvCache } from "./services/Gallery.js";
import { OpenApiGenerator, makeOpenApiGenerator } from "./services/OpenApiGenerator.js";
import { SchemaInferrer, makeSchemaInferrer } from "./services/SchemaInferrer.js";
import { Store, StoreD1Live, makeD1Store } from "./services/Store.js";
import { heal } from "./tools/Heal.js";
import { scout } from "./tools/Scout.js";
import { worker } from "./tools/Worker.js";

interface Env {
	DB: D1Database;
	STORAGE: R2Bucket;
	BROWSER: BrowserWorker;
	CACHE?: KVNamespace | undefined;
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

	return Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		BrowserCfLive(env.BROWSER),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
		Layer.succeed(Gallery, makeD1Gallery(env.DB, storeService, kvCache)),
	);
}

// ==================== Gallery Helpers ====================

function buildGalleryService(env: Env) {
	const storeService = makeD1Store(createDb(env.DB), env.STORAGE);
	const kvCache = env.CACHE ? makeKvCache(env.CACHE) : undefined;
	return makeD1Gallery(env.DB, storeService, kvCache);
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
	const { url, task } = body as { url: string; task: string };
	if (!url || !task) {
		return errorResponse("Missing 'url' and 'task' in request body", 400);
	}

	const result = await Effect.runPromise(
		scout({ url, task }).pipe(Effect.provide(buildLayer(env))),
	);

	return jsonResponse(result);
}

async function handleWorker(body: unknown, env: Env): Promise<Response> {
	const { pathId, data } = body as { pathId: string; data?: Record<string, unknown> };
	if (!pathId) {
		return errorResponse("Missing 'pathId' in request body", 400);
	}

	const layer = Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);

	const result = await Effect.runPromise(worker({ pathId, data }).pipe(Effect.provide(layer)));

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

		// Health check
		if (url.pathname === "/") {
			return jsonResponse({
				name: "unsurf",
				version: "0.2.0",
				description: "Turn any website into a typed API",
				tools: ["scout", "worker", "heal", "gallery"],
				mcp: "/mcp",
				docs: "https://unsurf.coey.dev",
			});
		}

		// MCP endpoint
		if (url.pathname === "/mcp") {
			return handleMcpRequest(request, env);
		}

		// Gallery routes
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
