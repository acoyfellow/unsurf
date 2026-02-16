import type { BrowserWorker } from "@cloudflare/puppeteer";
/**
 * unsurf — MCP Server
 *
 * Exposes scout, worker, and heal as MCP tools over Streamable HTTP.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Effect, Layer } from "effect";
import { z } from "zod";
import { makeAnthropicProvider } from "./ai/AnthropicProvider.js";
import { runScoutAgent } from "./ai/ScoutAgent.js";
import { createDb } from "./db/queries.js";
import { BrowserCfLive, makeCfBrowser } from "./services/Browser.js";
import { Directory, makeD1Directory } from "./services/Directory.js";
import { Gallery, makeD1Gallery, makeKvCache } from "./services/Gallery.js";
import { OpenApiGenerator, makeOpenApiGenerator } from "./services/OpenApiGenerator.js";
import { SchemaInferrer, makeSchemaInferrer } from "./services/SchemaInferrer.js";
import { StoreD1Live, makeD1Store } from "./services/Store.js";
import { heal } from "./tools/Heal.js";
import { scout } from "./tools/Scout.js";
import { worker } from "./tools/Worker.js";

interface Env {
	DB: D1Database;
	STORAGE: R2Bucket;
	BROWSER: BrowserWorker;
	CACHE?: KVNamespace | undefined;
	ANTHROPIC_API_KEY?: string | undefined;
	VECTORS?: unknown | undefined;
	AI?: unknown | undefined;
}

function buildGalleryService(env: Env) {
	const storeService = makeD1Store(createDb(env.DB), env.STORAGE);
	const kvCache = env.CACHE ? makeKvCache(env.CACHE) : undefined;
	return makeD1Gallery(env.DB, storeService, kvCache);
}

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

function buildWorkerLayer(env: Env) {
	return Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);
}

function okText(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

function errText(message: string) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
		isError: true as const,
	};
}

export function createMcpServer(env: Env): McpServer {
	const server = new McpServer(
		{ name: "unsurf", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	server.registerTool(
		"scout",
		{
			title: "Scout",
			description:
				"Explore a website and capture every API call. Returns captured endpoints with inferred schemas and an OpenAPI spec.",
			inputSchema: {
				url: z.string().url().describe("The URL to scout"),
				task: z.string().describe("What to look for, e.g. 'find all API endpoints'"),
				publish: z
					.boolean()
					.optional()
					.describe("Auto-publish the scouted site to the directory after scouting"),
			},
		},
		async ({ url, task, publish }) => {
			const result = await Effect.runPromise(
				scout({ url, task, publish }).pipe(Effect.provide(buildLayer(env))),
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"worker",
		{
			title: "Worker",
			description:
				"Replay a scouted API path directly — no browser needed. Pass the pathId from a scout result. Include headers for authenticated endpoints.",
			inputSchema: {
				pathId: z.string().describe("The path ID from a scout result"),
				data: z.record(z.string(), z.unknown()).optional().describe("Data to pass to the endpoint"),
				headers: z
					.record(z.string(), z.string())
					.optional()
					.describe("Custom headers (Authorization, Cookie, etc.) for authenticated endpoints"),
			},
		},
		async ({ pathId, data, headers }) => {
			const result = await Effect.runPromise(
				worker({ pathId, data, headers }).pipe(Effect.provide(buildWorkerLayer(env))),
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"heal",
		{
			title: "Heal",
			description: "Fix a broken path. Retries with backoff, then re-scouts and patches if needed.",
			inputSchema: {
				pathId: z.string().describe("The broken path ID"),
				error: z.string().optional().describe("The error message that caused the break"),
			},
		},
		async ({ pathId, error }) => {
			const result = await Effect.runPromise(
				heal({ pathId, error }).pipe(Effect.provide(buildLayer(env))),
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"gallery",
		{
			title: "Gallery",
			description:
				"Search the API gallery for previously unsurfed sites. Check here before scouting — someone may have already captured the API you need.",
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe("Search term (domain, endpoint path, or description)"),
				domain: z.string().optional().describe("Exact domain to look up"),
			},
		},
		async ({ query, domain }) => {
			const galleryService = buildGalleryService(env);
			const results = await Effect.runPromise(galleryService.search(query ?? "", domain));
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ results, total: results.length }, null, 2),
					},
				],
			};
		},
	);

	if (env.VECTORS && env.AI) {
		const directoryService = makeD1Directory(env.DB, env.STORAGE, env.VECTORS, env.AI);

		server.registerTool(
			"directory",
			{
				title: "Directory",
				description:
					"Fingerprint-first API directory. Look up domains, browse capabilities, inspect endpoints, semantic search, or publish scouted sites. Check here before scouting — returns token-efficient fingerprints, not full specs.",
				inputSchema: {
					action: z
						.enum(["fingerprint", "capability", "endpoint", "search", "publish"])
						.describe(
							"fingerprint: get domain overview (~50 tokens). capability: list endpoints by capability (~200 tokens). endpoint: single endpoint detail (~80 tokens). search: semantic search across all APIs. publish: add a scouted site to the directory.",
						),
					domain: z
						.string()
						.optional()
						.describe("Domain to look up (required for fingerprint, capability, endpoint)"),
					capability: z
						.enum([
							"auth",
							"payments",
							"content",
							"crud",
							"search",
							"messaging",
							"files",
							"analytics",
							"social",
							"ecommerce",
							"forms",
							"other",
						])
						.optional()
						.describe("Capability category (required for capability action)"),
					method: z.string().optional().describe("HTTP method (required for endpoint action)"),
					path: z.string().optional().describe("Endpoint path (required for endpoint action)"),
					query: z.string().optional().describe("Search query (required for search action)"),
					siteId: z
						.string()
						.optional()
						.describe("Site ID from a scout result (required for publish action)"),
				},
			},
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: routing dispatch
			async ({ action, domain, capability, method, path, query, siteId }) => {
				// biome-ignore lint/suspicious/noExplicitAny: Effect error channel
				const run = <A>(effect: Effect.Effect<A, any, never>): Promise<A> =>
					Effect.runPromise(effect);

				switch (action) {
					case "fingerprint": {
						if (!domain) return errText("domain is required for fingerprint action");
						const fp = await run(directoryService.getFingerprint(domain));
						return okText(fp);
					}
					case "capability": {
						if (!domain) return errText("domain is required for capability action");
						if (!capability) return errText("capability is required for capability action");
						const slice = await run(directoryService.getCapabilitySlice(domain, capability));
						return okText(slice);
					}
					case "endpoint": {
						if (!domain) return errText("domain is required for endpoint action");
						if (!method) return errText("method is required for endpoint action");
						if (!path) return errText("path is required for endpoint action");
						const ep = await run(directoryService.getEndpoint(domain, method, path));
						return okText(ep);
					}
					case "search": {
						if (!query) return errText("query is required for search action");
						const results = await run(directoryService.search(query));
						return okText({ results, total: results.length });
					}
					case "publish": {
						if (!siteId) return errText("siteId is required for publish action");
						const fp = await run(directoryService.publish(siteId));
						return okText(fp);
					}
				}
			},
		);
	}

	if (env.ANTHROPIC_API_KEY) {
		server.registerTool(
			"agent-scout",
			{
				title: "Agent Scout",
				description:
					"LLM-guided exploration — an AI agent clicks, types, and navigates to find more API endpoints than a simple page load.",
				inputSchema: {
					url: z.string().url().describe("The URL to explore"),
					task: z.string().describe("What to look for and do on the site"),
				},
			},
			async ({ url, task }) => {
				const llm = makeAnthropicProvider({
					apiKey: env.ANTHROPIC_API_KEY as string,
				});
				const browserEffect = Effect.scoped(
					Effect.gen(function* () {
						const browser = yield* makeCfBrowser(env.BROWSER);
						return yield* runScoutAgent({ browser, llm, url, task });
					}),
				);
				const result = await Effect.runPromise(browserEffect);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									steps: result.steps,
									networkEventsCount: result.events.length,
									events: result.events.map((e) => ({
										method: e.method,
										url: e.url,
										status: e.responseStatus,
									})),
								},
								null,
								2,
							),
						},
					],
				};
			},
		);
	}

	return server;
}

export async function handleMcpRequest(req: Request, env: Env): Promise<Response> {
	const transport = new WebStandardStreamableHTTPServerTransport({
		enableJsonResponse: true,
	});

	const server = createMcpServer(env);
	await server.connect(transport);

	try {
		return await transport.handleRequest(req);
	} finally {
		await server.close();
	}
}
