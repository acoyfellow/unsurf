/**
 * Worker Loader sandbox — scout a site, generate a typed client,
 * then execute it inside a Cloudflare Dynamic Worker Loader.
 *
 * Dynamic Worker Loaders create isolated V8 isolates at runtime.
 * Combined with unsurf's codegen, you get: typed API discovery → sandboxed execution.
 *
 * wrangler.toml:
 *   [[worker_loaders]]
 *   binding = "LOADER"
 *
 * This file is embedded in the docs and tested in CI.
 */
import { Effect, Layer } from "effect";
import {
	Browser,
	generateClient,
	makeTestBrowserWithEvents,
	makeTestStore,
	NetworkEvent,
	OpenApiGeneratorLive,
	SchemaInferrerLive,
	Store,
	scout,
} from "unsurf";

// --- Step 1: Scout a site and get an OpenAPI spec ---

const testEvents: NetworkEvent[] = [
	new NetworkEvent({
		requestId: "req-1",
		url: "https://api.example.com/products",
		method: "GET",
		resourceType: "fetch",
		requestHeaders: {},
		responseStatus: 200,
		responseHeaders: { "content-type": "application/json" },
		responseBody: JSON.stringify([
			{ id: 1, name: "Widget", price: 9.99, currency: "USD" },
			{ id: 2, name: "Gadget", price: 24.99, currency: "USD" },
		]),
		timestamp: Date.now(),
	}),
	new NetworkEvent({
		requestId: "req-2",
		url: "https://api.example.com/products/1",
		method: "GET",
		resourceType: "fetch",
		requestHeaders: {},
		responseStatus: 200,
		responseHeaders: { "content-type": "application/json" },
		responseBody: JSON.stringify({
			id: 1,
			name: "Widget",
			price: 9.99,
			currency: "USD",
			description: "A fine widget",
		}),
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
		url: "https://example.com",
		task: "find product listing and detail endpoints",
	}).pipe(Effect.provide(TestLayer)),
);

console.log(`Scouted ${result.endpointCount} endpoints`);

// --- Step 2: Generate a typed TypeScript client ---

const clientCode = generateClient(result.openApiSpec as object);
console.log("Generated client:\n", clientCode);

// --- Step 3: Wrap generated code for Worker Loader execution ---
// The Worker Loader sandbox gets the generated fetch functions
// plus a default export that the parent worker can call via RPC.

const sandboxCode = `
${clientCode}

// Export a default handler the parent worker calls via fetch()
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/products") {
      const data = await getProducts();
      return Response.json(data);
    }

    if (url.pathname.startsWith("/products/")) {
      const id = url.pathname.split("/").pop();
      const data = await getProductsById(id);
      return Response.json(data);
    }

    return new Response("Not found", { status: 404 });
  }
};
`;

// --- Step 4: Load into a Dynamic Worker Loader ---
// In a real Cloudflare Worker, this runs against env.LOADER:
//
//   const sandbox = env.LOADER.get("product-api", async () => ({
//     compatibilityDate: "2025-06-01",
//     mainModule: "client.js",
//     modules: { "client.js": sandboxCode },
//     globalOutbound: null, // network-isolated by default
//   }));
//
//   const entrypoint = sandbox.getEntrypoint();
//   const res = await entrypoint.fetch("http://sandbox/products");
//   const products = await res.json();
//   // products is typed: { id: number; name: string; price: number; currency: string }[]

console.log("Sandbox module ready — %d bytes", sandboxCode.length);
console.log("Worker Loader would execute this code in an isolated V8 isolate");
console.log("with network access restricted to the target API only.");
