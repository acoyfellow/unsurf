import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { CapturedEndpoint } from "../src/domain/Endpoint.js";
import { makeOpenApiGenerator } from "../src/services/OpenApiGenerator.js";

const generator = makeOpenApiGenerator();
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

function makeEndpoint(
	overrides: Partial<CapturedEndpoint> & { method: string; pathPattern: string },
): CapturedEndpoint {
	return {
		id: "ep-1",
		siteId: "site-1",
		requestSchema: Option.none(),
		responseSchema: Option.none(),
		sampleCount: 1,
		firstSeenAt: "2025-01-01T00:00:00Z",
		lastSeenAt: "2025-01-01T00:00:00Z",
		...overrides,
	} as CapturedEndpoint;
}

describe("OpenApiGenerator", () => {
	it("generates a valid OpenAPI 3.1 skeleton", async () => {
		const spec = await run(generator.generate("https://api.example.com", []));
		expect(spec.openapi).toBe("3.1.0");
		expect((spec.info as Record<string, unknown>).title).toBe("API for api.example.com");
		expect(spec.paths).toEqual({});
	});

	it("generates paths for GET endpoints", async () => {
		const endpoints = [
			makeEndpoint({
				method: "GET",
				pathPattern: "/users",
				responseSchema: Option.some({ type: "array", items: { type: "object" } }),
			}),
		];

		const spec = await run(generator.generate("https://api.example.com", endpoints));
		const paths = spec.paths as Record<string, Record<string, unknown>>;
		expect(paths["/users"]).toBeDefined();
		expect(paths["/users"]?.get).toBeDefined();
	});

	it("converts :param to {param} in paths", async () => {
		const endpoints = [makeEndpoint({ method: "GET", pathPattern: "/users/:id" })];

		const spec = await run(generator.generate("https://api.example.com", endpoints));
		const paths = spec.paths as Record<string, unknown>;
		expect(paths["/users/{id}"]).toBeDefined();
	});

	it("includes path parameters", async () => {
		const endpoints = [makeEndpoint({ method: "GET", pathPattern: "/users/:id/posts/:postId" })];

		const spec = await run(generator.generate("https://api.example.com", endpoints));
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
		const op = paths["/users/{id}/posts/{postId}"]?.get;
		const params = op?.parameters as Record<string, unknown>[];
		expect(params).toHaveLength(2);
		expect(params[0]?.name).toBe("id");
		expect(params[1]?.name).toBe("postId");
	});

	it("includes request body for POST", async () => {
		const endpoints = [
			makeEndpoint({
				method: "POST",
				pathPattern: "/users",
				requestSchema: Option.some({ type: "object", properties: { name: { type: "string" } } }),
			}),
		];

		const spec = await run(generator.generate("https://api.example.com", endpoints));
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
		const op = paths["/users"]?.post;
		expect(op?.requestBody).toBeDefined();

		const body = op?.requestBody as Record<string, unknown>;
		expect(body.required).toBe(true);
	});

	it("does not include request body for GET", async () => {
		const endpoints = [makeEndpoint({ method: "GET", pathPattern: "/users" })];

		const spec = await run(generator.generate("https://api.example.com", endpoints));
		const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
		const op = paths["/users"]?.get;
		expect(op?.requestBody).toBeUndefined();
	});

	it("groups multiple methods under same path", async () => {
		const endpoints = [
			makeEndpoint({ id: "ep-1", method: "GET", pathPattern: "/users" }),
			makeEndpoint({ id: "ep-2", method: "POST", pathPattern: "/users" }),
		];

		const spec = await run(generator.generate("https://api.example.com", endpoints));
		const paths = spec.paths as Record<string, Record<string, unknown>>;
		const usersPath = paths["/users"];
		expect(usersPath?.get).toBeDefined();
		expect(usersPath?.post).toBeDefined();
	});

	it("includes server URL", async () => {
		const spec = await run(generator.generate("https://api.example.com", []));
		const servers = spec.servers as Record<string, unknown>[];
		expect(servers[0]?.url).toBe("https://api.example.com");
	});
});
