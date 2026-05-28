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
import { makeD1Directory } from "./services/Directory.js";
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
	ANTHROPIC_API_KEY?: string | undefined;
	VECTORS?: unknown | undefined;
	AI?: unknown | undefined;
	// Added for unsurf_search / unsurf_execute MCP tools. search/execute
	// reach the trace.coey.dev Worker and Workers AI from inside the main
	// worker's Fetcher context. Optional — the tools self-report
	// misconfiguration if any are missing.
	TRACE_INGEST_TOKEN?: string | undefined;
	CLOUDFLARE_ACCOUNT_ID?: string | undefined;
	CLOUDFLARE_API_TOKEN?: string | undefined;
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
		{ name: "unsurf", version: "0.2.0" },
		{ capabilities: { tools: {} } },
	);

	server.registerTool(
		"scout",
		{
			title: "Scout",
			description:
				"Use when you need to discover what API endpoints a website uses internally. " +
				"Opens the URL in a headless browser, captures all network traffic (XHR/fetch), " +
				"groups requests by endpoint pattern, infers request/response schemas, and generates an OpenAPI spec. " +
				"Returns a siteId (for publishing), pathId (for replaying via worker), endpoint count, and the full OpenAPI spec. " +
				"Check gallery/directory first — the site may already be captured.",
			inputSchema: {
				url: z
					.string()
					.url()
					.describe(
						"Full URL to scout, e.g. 'https://api.example.com' or 'https://app.example.com/dashboard'",
					),
				task: z
					.string()
					.describe(
						"What to look for — guides which page to visit. E.g. 'find all API endpoints', 'discover the search API', 'map the user authentication flow'",
					),
				publish: z
					.boolean()
					.optional()
					.describe(
						"Set true to auto-publish results to the public API directory after scouting. Default: false (private).",
					),
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
				"Use to execute a previously scouted API endpoint directly — no browser needed. " +
				"Looks up the pathId from a scout result, finds the matching endpoint, and replays the HTTP request. " +
				"Returns the API response. Requires a pathId from a previous scout result. " +
				"SAFETY: Endpoints are classified by risk level (safe/moderate/unsafe/destructive). " +
				"Unsafe and destructive endpoints (DELETE, billing mutations, account changes) are blocked by default — " +
				"pass confirmUnsafe: true only after reviewing the endpoint and confirming the action is intended. " +
				"If it fails, use 'heal' to fix the broken path.",
			inputSchema: {
				pathId: z
					.string()
					.describe(
						"Path ID from a scout result (format: path_<timestamp>_<random>). Get this from the scout tool's output.",
					),
				data: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						"Data for the request. Used as JSON body for POST/PUT/PATCH, or substituted into URL params for GET (e.g. {id: '123'} fills :id).",
					),
				headers: z
					.record(z.string(), z.string())
					.optional()
					.describe(
						"Custom HTTP headers. Use for authenticated endpoints: {'Authorization': 'Bearer <token>'} or {'Cookie': 'session=abc'}.",
					),
				confirmUnsafe: z
					.boolean()
					.optional()
					.describe(
						"Must be true to execute unsafe or destructive endpoints (DELETE, billing mutations, account changes). " +
							"The worker will block these by default and return the safety classification so you can review before confirming.",
					),
			},
		},
		async ({ pathId, data, headers, confirmUnsafe }) => {
			const result = await Effect.runPromise(
				worker({ pathId, data, headers, confirmUnsafe }).pipe(
					Effect.provide(buildWorkerLayer(env)),
				),
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
			description:
				"Use when a worker call fails — fixes broken API paths automatically. " +
				"First retries the endpoint with exponential backoff (handles transient errors). " +
				"If retries fail, re-scouts the original URL to discover updated endpoints, then verifies the new path works. " +
				"Returns whether healing succeeded and optionally a new pathId to use going forward.",
			inputSchema: {
				pathId: z.string().describe("The broken path ID from a failed worker call"),
				error: z
					.string()
					.optional()
					.describe(
						"The error message from the failed worker call — helps diagnose the issue (e.g. 'HTTP 404', 'endpoint returned HTML instead of JSON')",
					),
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
				"Search the cache of previously scouted APIs before using scout. " +
				"Returns matching sites with their domains, endpoint counts, and OpenAPI spec availability. " +
				"Much faster than scouting — no browser needed. Use this first to avoid redundant scouting.",
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe(
						"Free-text search — matches domain names, endpoint paths, and descriptions. E.g. 'weather', 'pokemon', 'user authentication'",
					),
				domain: z
					.string()
					.optional()
					.describe("Exact domain lookup, e.g. 'api.github.com'. More precise than query search."),
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
					"The public API directory — look up domains, browse by capability, inspect endpoints, or search across all known APIs. " +
					"Start with 'fingerprint' for a lightweight overview (~50 tokens), drill into 'capability' for endpoint lists, " +
					"or use 'search' for semantic matching. Use 'publish' to add a scouted site. " +
					"Token-efficient: returns compact fingerprints, not full specs.",
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
					"Use instead of regular scout when the site requires interaction — clicking buttons, filling forms, navigating menus — " +
					"to trigger API calls that wouldn't appear from a simple page load. " +
					"An AI agent controls the browser, performing actions you describe, while capturing all network traffic. " +
					"More thorough but slower and more expensive than regular scout. Use regular scout first; escalate to agent-scout if it finds too few endpoints.",
				inputSchema: {
					url: z.string().url().describe("The URL to explore"),
					task: z
						.string()
						.describe(
							"Instructions for the AI browser agent. Be specific: 'click the search button, type a query, submit the form' rather than just 'find search API'",
						),
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

	// ==================== unsurf_search + unsurf_execute ====================
	//
	// Two-tool pair pattern: one to discover, one to act. Matches the
	// Cloudflare MCP shape the user asked for.
	//
	// `unsurf_search` — list past traces, filter by owner/task/visibility.
	// `unsurf_execute` — Worker-safe skill invocations. One action today:
	//                    `loopPlan` generates a structured LoopSpec from a
	//                    natural-language goal via Kimi K2.6.
	//                    Actually running record() or observeVideo()
	//                    requires Node APIs (agent-browser subprocess /
	//                    ffmpeg) that don't exist inside a Worker. Those
	//                    are CLI-only for now; add them here once we have
	//                    the cloud recording provider (Phase 4 in
	//                    NORTHSTAR.md).

	const TRACE_ENDPOINT = "https://trace.coey.dev";

	server.registerTool(
		"unsurf_search",
		{
			title: "Unsurf — search traces",
			description:
				"List recorded unsurf traces (video + step trace + metadata). Filter by " +
				"owner (the token's owner tag), free-text task substring, and visibility. " +
				"Returns viewerUrls ready to open (grants pre-minted for private/public " +
				"traces). Use this when the user asks 'find my recent traces', 'show me " +
				"the loop demo from earlier', 'list private recordings', etc. " +
				"Requires TRACE_INGEST_TOKEN in the MCP server's env.",
			inputSchema: {
				owner: z
					.string()
					.optional()
					.describe("Owner tag to filter by (only effective when auth is the root token)"),
				q: z.string().optional().describe("Case-insensitive substring match on trace.task"),
				visibility: z
					.enum(["public", "private", "grandfathered"])
					.optional()
					.describe("Filter by visibility classification"),
				limit: z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
				cursor: z.string().optional().describe("Pagination cursor from a previous response"),
			},
		},
		async ({ owner, q, visibility, limit, cursor }) => {
			const token = env.TRACE_INGEST_TOKEN;
			if (!token) {
				return errText(
					"TRACE_INGEST_TOKEN is not configured on this MCP server; cannot search traces.",
				);
			}
			const u = new URL(`${TRACE_ENDPOINT}/search`);
			if (owner) u.searchParams.set("owner", owner);
			if (q) u.searchParams.set("q", q);
			if (visibility) u.searchParams.set("visibility", visibility);
			if (typeof limit === "number") u.searchParams.set("limit", String(limit));
			if (cursor) u.searchParams.set("cursor", cursor);
			const res = await fetch(u.toString(), {
				headers: { authorization: `Bearer ${token}` },
			});
			if (!res.ok) {
				return errText(`search failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
			}
			return okText(await res.json());
		},
	);

	server.registerTool(
		"unsurf_execute",
		{
			title: "Unsurf — execute a skill",
			description:
				"Run one of unsurf's Worker-safe skills. Two actions supported from MCP: " +
				"'observeVideo' (answer a natural-language question about a trace's video) and " +
				"'loopPlan' (synthesize a structured LoopSpec from a natural-language goal using " +
				"Kimi K2.6 via Workers AI — plan only, no browser). " +
				"Use observeVideo when the user asks 'did the agent succeed in this trace', " +
				"'what happened in recording X', 'summarize this video'. Use loopPlan when " +
				"the user wants a step-by-step plan to feed to unsurf.loop() or to hand to " +
				"a local agent that will call record() from their own machine. " +
				"Actually recording a new trace requires a local agent-browser and is NOT " +
				"exposed through MCP — use the CLI or agent-browser skill for that.",
			inputSchema: {
				action: z.enum(["loopPlan"]).describe("Which skill to invoke"),
				goal: z.string().describe("loopPlan: natural-language description of the browser task"),
				northStar: z.string().describe("loopPlan: yes/no success condition for the task"),
			},
		},
		async ({ action, goal, northStar }) => {
			if (action === "loopPlan") {
				if (!goal || !northStar) {
					return errText("loopPlan requires both `goal` and `northStar`");
				}
				try {
					// Dynamic import so this stays lazy — kimiPlanner reads
					// CLOUDFLARE_API_TOKEN / ACCOUNT_ID from env. In the Worker
					// context those are provided via bindings; we re-export them
					// into process.env at call time so the REST-based backend
					// works unchanged.
					if (env.CLOUDFLARE_ACCOUNT_ID && !process.env.CLOUDFLARE_ACCOUNT_ID) {
						process.env.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
					}
					if (env.CLOUDFLARE_API_TOKEN && !process.env.CLOUDFLARE_API_TOKEN) {
						process.env.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN;
					}
					const { kimiPlanner } = await import("./skills/loop/index.js");
					const spec = await kimiPlanner().plan({ goal, northStar });
					return okText({
						spec,
						hint:
							'Feed this spec to `unsurf loop <spec.json> --north-star "..."` ' +
							"from a local shell, or to `loop({ spec, northStar })` from your own " +
							"agent. Actually recording requires agent-browser on the caller's " +
							"machine; that path is CLI-only until Phase 4 (cloud recording).",
					});
				} catch (e) {
					return errText(`loopPlan failed: ${(e as Error).message.slice(0, 300)}`);
				}
			}
			return errText(`unknown action: ${action}`);
		},
	);

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
