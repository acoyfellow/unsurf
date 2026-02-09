/**
 * Scout with dependency injection — how unsurf swaps real browser for test doubles.
 * This file is embedded in the docs and tested in CI.
 */
import { Effect, Layer } from "effect";
import {
	Browser,
	NetworkEvent,
	OpenApiGenerator,
	OpenApiGeneratorLive,
	SchemaInferrer,
	SchemaInferrerLive,
	Store,
	makeTestBrowserWithEvents,
	makeTestStore,
	scout,
} from "unsurf";

// Create test fixtures — the same events a real browser would capture
const testEvents: NetworkEvent[] = [
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

// Build layers — test browser + in-memory store + real inferrer/generator
const TestLayer = Layer.mergeAll(
	Layer.succeed(Browser, makeTestBrowserWithEvents(testEvents)),
	Layer.succeed(Store, makeTestStore()),
	SchemaInferrerLive,
	OpenApiGeneratorLive,
);

// Run scout with test dependencies — no real browser, no real DB
const result = await Effect.runPromise(
	scout({
		url: "https://jsonplaceholder.typicode.com",
		task: "discover all API endpoints",
	}).pipe(Effect.provide(TestLayer)),
);

console.log(`Found ${result.endpointCount} endpoints`);
console.log(`Site ID: ${result.siteId}`);
console.log(`Path ID: ${result.pathId}`);
const paths = (result.openApiSpec as Record<string, unknown>).paths as Record<string, unknown>;
console.log("OpenAPI paths:", Object.keys(paths));
// → Found 1 endpoints
// → Site ID: site_...
// → Path ID: path_...
// → OpenAPI paths: ["/posts"]
