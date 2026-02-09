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
import { BrowserCfLive, makeCfBrowser } from "./services/Browser.js";
import { OpenApiGenerator, makeOpenApiGenerator } from "./services/OpenApiGenerator.js";
import { SchemaInferrer, makeSchemaInferrer } from "./services/SchemaInferrer.js";
import { StoreD1Live } from "./services/Store.js";
import { heal } from "./tools/Heal.js";
import { scout } from "./tools/Scout.js";
import { worker } from "./tools/Worker.js";

interface Env {
	DB: D1Database;
	STORAGE: R2Bucket;
	BROWSER: BrowserWorker;
	ANTHROPIC_API_KEY?: string | undefined;
}

function buildLayer(env: Env) {
	return Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		BrowserCfLive(env.BROWSER),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);
}

function buildWorkerLayer(env: Env) {
	return Layer.mergeAll(
		StoreD1Live(env.DB, env.STORAGE),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
	);
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
			},
		},
		async ({ url, task }) => {
			const result = await Effect.runPromise(
				scout({ url, task }).pipe(Effect.provide(buildLayer(env))),
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
				"Replay a scouted API path directly — no browser needed. Pass the pathId from a scout result.",
			inputSchema: {
				pathId: z.string().describe("The path ID from a scout result"),
				data: z.record(z.string(), z.unknown()).optional().describe("Data to pass to the endpoint"),
			},
		},
		async ({ pathId, data }) => {
			const result = await Effect.runPromise(
				worker({ pathId, data }).pipe(Effect.provide(buildWorkerLayer(env))),
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
