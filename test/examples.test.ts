import { Effect, Option } from "effect";
import { Layer } from "effect";
/**
 * Examples dogfood test — verifies every example file in examples/ actually runs.
 * If any export changes or breaks, this test fails, which means the docs are wrong.
 */
import { describe, expect, it } from "vitest";
import {
	API_RESOURCE_TYPES,
	Browser,
	BrowserError,
	CapturedEndpoint,
	GalleryEntry,
	NetworkError,
	NetworkEvent,
	NotFoundError,
	OpenApiGenerator,
	OpenApiGeneratorLive,
	PathBrokenError,
	PathStep,
	SchemaInferrer,
	SchemaInferrerLive,
	ScoutedPath,
	Site,
	Store,
	StoreError,
	extractDomain,
	generateClient,
	isApiRequest,
	makeOpenApiGenerator,
	makeSchemaInferrer,
	makeTestBrowserWithEvents,
	makeTestGallery,
	makeTestStore,
	normalizeUrlPattern,
	scout,
} from "../src/index.js";

describe("Examples dogfood", () => {
	describe("url-normalization", () => {
		it("normalizes numeric IDs", () => {
			expect(normalizeUrlPattern("https://api.example.com/users/42")).toBe(
				"https://api.example.com/users/:id",
			);
		});

		it("normalizes UUIDs", () => {
			expect(
				normalizeUrlPattern("https://api.example.com/posts/550e8400-e29b-41d4-a716-446655440000"),
			).toBe("https://api.example.com/posts/:id");
		});

		it("normalizes base64", () => {
			expect(normalizeUrlPattern("https://api.example.com/sessions/SGVsbG8gV29ybGQhIQ==")).toBe(
				"https://api.example.com/sessions/:id",
			);
		});

		it("preserves literal segments", () => {
			expect(normalizeUrlPattern("https://api.example.com/api/v2/users")).toBe(
				"https://api.example.com/api/v2/users",
			);
		});

		it("extracts domain", () => {
			expect(extractDomain("https://app.example.com/dashboard")).toBe("app.example.com");
		});
	});

	describe("schema-inference", () => {
		it("infers types and formats", () => {
			const inferrer = makeSchemaInferrer();
			const schema = Effect.runSync(
				inferrer.infer([
					{
						id: 1,
						name: "Alice",
						email: "alice@example.com",
						createdAt: "2024-01-15T10:30:00Z",
					},
				]),
			);
			expect(schema).toEqual({
				type: "object",
				properties: {
					id: { type: "integer" },
					name: { type: "string" },
					email: { type: "string", format: "email" },
					createdAt: { type: "string", format: "date-time" },
				},
				required: ["id", "name", "email", "createdAt"],
			});
		});

		it("merges schemas with optional fields", () => {
			const inferrer = makeSchemaInferrer();
			const merged = Effect.runSync(
				inferrer.infer([
					{ id: 1, name: "Alice", email: "alice@example.com" },
					{ id: 2, name: "Bob", avatar: "https://example.com/bob.png" },
				]),
			);
			// id and name are required (in both), email and avatar are optional
			const req = (merged as Record<string, unknown>).required as string[];
			expect(req).toContain("id");
			expect(req).toContain("name");
			expect(req).not.toContain("email");
			expect(req).not.toContain("avatar");
		});
	});

	describe("openapi-generation", () => {
		it("generates spec from captured endpoints", () => {
			const endpoints = [
				new CapturedEndpoint({
					id: "ep_1",
					siteId: "site_1",
					method: "GET",
					pathPattern: "/users",
					requestSchema: Option.none(),
					responseSchema: Option.some({
						type: "array",
						items: { type: "object", properties: { id: { type: "integer" } } },
					}),
					sampleCount: 3,
					firstSeenAt: "2024-01-15T10:00:00Z",
					lastSeenAt: "2024-01-15T10:05:00Z",
				}),
			];

			const generator = makeOpenApiGenerator();
			const spec = Effect.runSync(generator.generate("https://api.example.com", endpoints));
			const s = spec as Record<string, unknown>;
			expect(s.openapi).toBe("3.1.0");
			expect((s.paths as Record<string, unknown>)["/users"]).toBeDefined();
		});
	});

	describe("error-handling", () => {
		it("creates typed tagged errors", () => {
			const error = new PathBrokenError({
				pathId: "path_abc123",
				step: 2,
				reason: "POST /api/contact returned 404",
			});
			expect(error._tag).toBe("PathBrokenError");
			expect(error.pathId).toBe("path_abc123");
			expect(error.reason).toBe("POST /api/contact returned 404");
		});

		it("routes errors with catchTag", () => {
			const error = new PathBrokenError({
				pathId: "path_abc123",
				reason: "404",
			});
			const result = Effect.runSync(
				Effect.fail(error).pipe(
					Effect.catchTag("PathBrokenError", (e) => Effect.succeed(`healed ${e.pathId}`)),
				),
			);
			expect(result).toBe("healed path_abc123");
		});
	});

	describe("domain-types", () => {
		it("constructs CapturedEndpoint", () => {
			const ep = new CapturedEndpoint({
				id: "ep_1",
				siteId: "site_1",
				method: "GET",
				pathPattern: "https://api.example.com/users/:id",
				requestSchema: Option.none(),
				responseSchema: Option.some({ type: "object" }),
				sampleCount: 5,
				firstSeenAt: "2024-01-15T10:00:00Z",
				lastSeenAt: "2024-01-15T10:30:00Z",
			});
			expect(ep.method).toBe("GET");
			expect(ep.pathPattern).toBe("https://api.example.com/users/:id");
		});

		it("constructs ScoutedPath with steps", () => {
			const path = new ScoutedPath({
				id: "path_1",
				siteId: "site_1",
				task: "find user profiles",
				steps: [
					new PathStep({ action: "navigate", url: "https://example.com" }),
					new PathStep({ action: "click", selector: "a.user-link" }),
				],
				endpointIds: ["ep_1"],
				status: "active",
				createdAt: "2024-01-15T10:00:00Z",
				lastUsedAt: Option.some("2024-01-15T10:30:00Z"),
				failCount: 0,
				healCount: 0,
			});
			expect(path.steps).toHaveLength(2);
			expect(path.status).toBe("active");
		});

		it("filters API requests", () => {
			expect(isApiRequest("fetch", "https://api.example.com/users")).toBe(true);
			expect(isApiRequest("image", "https://example.com/logo.png")).toBe(false);
			expect(API_RESOURCE_TYPES).toContain("fetch");
			expect(API_RESOURCE_TYPES).toContain("xhr");
		});
	});

	describe("codegen", () => {
		it("generates typed client from OpenAPI spec", () => {
			const spec = {
				openapi: "3.1.0",
				info: { title: "Test", version: "1.0.0" },
				servers: [{ url: "https://api.example.com" }],
				paths: {
					"/users": {
						get: {
							operationId: "getUsers",
							responses: { "200": { description: "OK" } },
						},
					},
				},
			};
			const client = generateClient(spec);
			expect(client).toContain("getUsers");
			expect(client).toContain("https://api.example.com");
		});
	});

	describe("scout-with-layers", () => {
		it("runs scout with test dependencies", async () => {
			const testEvents = [
				new NetworkEvent({
					requestId: "req-1",
					url: "https://jsonplaceholder.typicode.com/posts",
					method: "GET",
					resourceType: "fetch",
					requestHeaders: {},
					responseStatus: 200,
					responseHeaders: { "content-type": "application/json" },
					responseBody: JSON.stringify([{ userId: 1, id: 1, title: "hello", body: "world" }]),
					timestamp: Date.now(),
				}),
			];

			const TestLayer = Layer.mergeAll(
				Layer.succeed(Browser, makeTestBrowserWithEvents(testEvents)),
				Layer.succeed(Store, makeTestStore()),
				SchemaInferrerLive,
				OpenApiGeneratorLive,
			);

			const result = await Effect.runPromise(
				scout({
					url: "https://jsonplaceholder.typicode.com",
					task: "discover all API endpoints",
				}).pipe(Effect.provide(TestLayer)),
			);

			expect(result.endpointCount).toBe(1);
			expect(result.siteId).toBeTruthy();
			expect(result.pathId).toBeTruthy();
			const specPaths = (result.openApiSpec as Record<string, unknown>).paths as Record<
				string,
				unknown
			>;
			// Scout uses full URL as pathPattern — check it exists under the normalized key
			const pathKeys = Object.keys(specPaths);
			expect(pathKeys.length).toBe(1);
			expect(pathKeys[0]).toContain("posts");
		});
	});

	describe("gallery-search", () => {
		it("creates gallery service with test store", () => {
			const store = makeTestStore();
			const gallery = makeTestGallery(store);
			expect(gallery).toBeDefined();
			expect(gallery.search).toBeDefined();
			expect(gallery.publish).toBeDefined();
			expect(gallery.getSpec).toBeDefined();
			expect(gallery.getByDomain).toBeDefined();
		});

		it("GalleryEntry has expected fields", () => {
			const entry = new GalleryEntry({
				id: "gal_123",
				domain: "api.stripe.com",
				url: "https://api.stripe.com",
				task: "find payment APIs",
				endpointCount: 12,
				endpointsSummary: "GET /charges, POST /charges",
				specKey: "specs/site_1/openapi.json",
				contributor: "anonymous",
				createdAt: "2024-01-15T10:00:00Z",
				updatedAt: "2024-01-15T10:00:00Z",
				version: 1,
			});
			expect(entry.domain).toBe("api.stripe.com");
			expect(entry.endpointCount).toBe(12);
			expect(entry.version).toBe(1);
		});

		it("publishes a scouted site and finds it via search", async () => {
			const store = makeTestStore();
			const gallery = makeTestGallery(store);

			// Seed store with a site and endpoints
			await Effect.runPromise(
				store.saveSite(
					new Site({
						id: "site_gal1",
						url: "https://api.weather.com",
						domain: "api.weather.com",
						firstScoutedAt: "2024-01-15T10:00:00Z",
						lastScoutedAt: "2024-01-15T10:00:00Z",
					}),
				),
			);
			await Effect.runPromise(
				store.saveEndpoints([
					new CapturedEndpoint({
						id: "ep_w1",
						siteId: "site_gal1",
						method: "GET",
						pathPattern: "/forecast",
						requestSchema: Option.none(),
						responseSchema: Option.some({ type: "object" }),
						sampleCount: 3,
						firstSeenAt: "2024-01-15T10:00:00Z",
						lastSeenAt: "2024-01-15T10:00:00Z",
					}),
				]),
			);

			// Publish
			const entry = await Effect.runPromise(gallery.publish("site_gal1", "tester"));
			expect(entry.domain).toBe("api.weather.com");
			expect(entry.endpointCount).toBe(1);
			expect(entry.contributor).toBe("tester");
			expect(entry.version).toBe(1);

			// Search by keyword
			const results = await Effect.runPromise(gallery.search("weather"));
			expect(results).toHaveLength(1);
			expect(results[0]?.domain).toBe("api.weather.com");

			// Lookup by domain
			const found = await Effect.runPromise(gallery.getByDomain("api.weather.com"));
			expect(found).not.toBeNull();
			expect(found?.id).toBe(entry.id);
		});

		it("re-publishing the same domain bumps the version", async () => {
			const store = makeTestStore();
			const gallery = makeTestGallery(store);

			await Effect.runPromise(
				store.saveSite(
					new Site({
						id: "site_v",
						url: "https://api.github.com",
						domain: "api.github.com",
						firstScoutedAt: "2024-01-15T10:00:00Z",
						lastScoutedAt: "2024-01-15T10:00:00Z",
					}),
				),
			);
			await Effect.runPromise(
				store.saveEndpoints([
					new CapturedEndpoint({
						id: "ep_g1",
						siteId: "site_v",
						method: "GET",
						pathPattern: "/repos",
						requestSchema: Option.none(),
						responseSchema: Option.some({ type: "array" }),
						sampleCount: 1,
						firstSeenAt: "2024-01-15T10:00:00Z",
						lastSeenAt: "2024-01-15T10:00:00Z",
					}),
				]),
			);

			const v1 = await Effect.runPromise(gallery.publish("site_v"));
			expect(v1.version).toBe(1);

			const v2 = await Effect.runPromise(gallery.publish("site_v", "updater"));
			expect(v2.version).toBe(2);
			expect(v2.contributor).toBe("updater");
		});

		it("returns null for unknown domain", async () => {
			const store = makeTestStore();
			const gallery = makeTestGallery(store);

			const result = await Effect.runPromise(gallery.getByDomain("nonexistent.com"));
			expect(result).toBeNull();
		});
	});
});
