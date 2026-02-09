import type { BrowserWorker } from "@cloudflare/puppeteer";
/**
 * unsurf — Turn any website into a typed API
 *
 * Cloudflare Worker entry point
 */
import { Effect, Layer } from "effect";
import { BrowserCfLive } from "./services/Browser.js";
import { Browser } from "./services/Browser.js";
import { OpenApiGenerator, makeOpenApiGenerator } from "./services/OpenApiGenerator.js";
import { SchemaInferrer, makeSchemaInferrer } from "./services/SchemaInferrer.js";
import { Store, StoreD1Live } from "./services/Store.js";
import { heal } from "./tools/Heal.js";
import { scout } from "./tools/Scout.js";
import { worker } from "./tools/Worker.js";

interface Env {
	DB: D1Database;
	STORAGE: R2Bucket;
	BROWSER: BrowserWorker;
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
	return Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		BrowserCfLive(env.BROWSER),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);
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
				version: "0.0.1",
				description: "Turn any website into a typed API",
				tools: ["scout", "worker", "heal"],
				docs: "https://unsurf.coey.dev",
			});
		}

		// Tool routes
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
