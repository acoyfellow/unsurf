import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { NetworkEvent } from "../src/domain/NetworkEvent.js";
import { Browser, makeTestBrowserWithEvents } from "../src/services/Browser.js";
import { Gallery, makeTestGallery } from "../src/services/Gallery.js";
import { OpenApiGenerator, makeOpenApiGenerator } from "../src/services/OpenApiGenerator.js";
import { SchemaInferrer, makeSchemaInferrer } from "../src/services/SchemaInferrer.js";
import { Store, makeTestStore } from "../src/services/Store.js";
import { scout } from "../src/tools/Scout.js";

// ==================== Test Fixtures ====================

function makeApiEvents(domain: string): NetworkEvent[] {
	return [
		new NetworkEvent({
			requestId: "req-1",
			url: `https://${domain}/api/users`,
			method: "GET",
			resourceType: "fetch",
			requestHeaders: { accept: "application/json" },
			responseStatus: 200,
			responseHeaders: { "content-type": "application/json" },
			responseBody: JSON.stringify([{ id: 1, name: "Alice" }]),
			timestamp: Date.now(),
		}),
		new NetworkEvent({
			requestId: "req-2",
			url: `https://${domain}/api/posts`,
			method: "POST",
			resourceType: "xhr",
			requestHeaders: { "content-type": "application/json" },
			requestBody: JSON.stringify({ title: "Hello" }),
			responseStatus: 201,
			responseHeaders: { "content-type": "application/json" },
			responseBody: JSON.stringify({ id: 42, title: "Hello" }),
			timestamp: Date.now(),
		}),
	];
}

function buildFullLayer(
	events: NetworkEvent[],
	store: ReturnType<typeof makeTestStore>,
	gallery: ReturnType<typeof makeTestGallery>,
) {
	return Layer.mergeAll(
		Layer.succeed(Browser, makeTestBrowserWithEvents(events)),
		Layer.succeed(Store, store),
		Layer.succeed(SchemaInferrer, makeSchemaInferrer()),
		Layer.succeed(OpenApiGenerator, makeOpenApiGenerator()),
		Layer.succeed(Gallery, gallery),
	);
}

// ==================== E2E Tests ====================

describe("Gallery E2E", () => {
	it("1. scout a site and publish to gallery", async () => {
		const store = makeTestStore();
		const gallery = makeTestGallery(store);
		const events = makeApiEvents("api.example.com");
		const layer = buildFullLayer(events, store, gallery);

		const result = await Effect.runPromise(
			scout({ url: "https://api.example.com", task: "find all APIs" }).pipe(Effect.provide(layer)),
		);

		expect(result.endpointCount).toBeGreaterThan(0);
		expect(result.siteId).toBeTruthy();
		expect(result.fromGallery).toBeUndefined();
	});

	it("2. published site appears in gallery search", async () => {
		const store = makeTestStore();
		const gallery = makeTestGallery(store);
		const events = makeApiEvents("api.example.com");
		const layer = buildFullLayer(events, store, gallery);

		await Effect.runPromise(
			scout({ url: "https://api.example.com", task: "find all APIs" }).pipe(Effect.provide(layer)),
		);

		// Search by domain
		const byDomain = await Effect.runPromise(gallery.search("", "api.example.com"));
		expect(byDomain.length).toBe(1);
		expect(byDomain[0]?.domain).toBe("api.example.com");
	});

	it("3. scout same domain again — gallery cache hit (no browser)", async () => {
		const store = makeTestStore();
		const gallery = makeTestGallery(store);
		const events = makeApiEvents("api.example.com");
		const layer = buildFullLayer(events, store, gallery);

		// First scout — goes through browser
		const first = await Effect.runPromise(
			scout({ url: "https://api.example.com", task: "find all APIs" }).pipe(Effect.provide(layer)),
		);
		expect(first.fromGallery).toBeUndefined();

		// Second scout — should come from gallery (no browser needed)
		// Use empty events to prove browser isn't used
		const emptyLayer = buildFullLayer([], store, gallery);
		const second = await Effect.runPromise(
			scout({ url: "https://api.example.com", task: "find all APIs" }).pipe(
				Effect.provide(emptyLayer),
			),
		);
		expect(second.fromGallery).toBe(true);
		expect(second.endpointCount).toBeGreaterThan(0);
	});

	it("4. search by endpoint path finds the site", async () => {
		const store = makeTestStore();
		const gallery = makeTestGallery(store);
		const events = makeApiEvents("api.example.com");
		const layer = buildFullLayer(events, store, gallery);

		await Effect.runPromise(
			scout({ url: "https://api.example.com", task: "find all APIs" }).pipe(Effect.provide(layer)),
		);

		// Search by endpoint path keyword
		const results = await Effect.runPromise(gallery.search("users"));
		expect(results.length).toBe(1);
		expect(results[0]?.endpointsSummary).toContain("users");
	});

	it("5. fetch full spec returns valid OpenAPI", async () => {
		const store = makeTestStore();
		const gallery = makeTestGallery(store);
		const events = makeApiEvents("api.example.com");
		const layer = buildFullLayer(events, store, gallery);

		await Effect.runPromise(
			scout({ url: "https://api.example.com", task: "find all APIs" }).pipe(Effect.provide(layer)),
		);

		const entries = await Effect.runPromise(gallery.search("", "api.example.com"));
		expect(entries.length).toBe(1);
		const entry = entries[0];
		expect(entry).toBeDefined();

		const spec = await Effect.runPromise(gallery.getSpec(entry?.id ?? ""));
		expect(spec.openapi).toBe("3.1.0");
		expect(spec.paths).toBeDefined();
	});

	it("6. publish:false skips gallery publish", async () => {
		const store = makeTestStore();
		const gallery = makeTestGallery(store);
		const events = makeApiEvents("api.nopublish.com");
		const layer = buildFullLayer(events, store, gallery);

		await Effect.runPromise(
			scout({
				url: "https://api.nopublish.com",
				task: "test",
				publish: false,
			}).pipe(Effect.provide(layer)),
		);

		const results = await Effect.runPromise(gallery.search("", "api.nopublish.com"));
		expect(results.length).toBe(0);
	});
});
