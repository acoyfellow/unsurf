/**
 * Worker Loader pipeline — scout multiple sites, generate typed clients,
 * execute them all in parallel Dynamic Worker Loader sandboxes.
 *
 * Real-world use case: a price comparison agent that discovers product APIs
 * from multiple stores, generates typed clients, then runs them all in
 * parallel sandboxed isolates to fetch and normalize results.
 *
 * Each sandbox is network-isolated — it can only reach the specific API
 * it was generated for, preventing data exfiltration across sources.
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

// --- Simulate two different store APIs discovered by scout ---

const storeAEvents: NetworkEvent[] = [
	new NetworkEvent({
		requestId: "a-1",
		url: "https://api.store-a.example.com/search?q=headphones",
		method: "GET",
		resourceType: "fetch",
		requestHeaders: {},
		responseStatus: 200,
		responseHeaders: { "content-type": "application/json" },
		responseBody: JSON.stringify({
			results: [
				{ sku: "A-100", title: "Pro Headphones", price: 79.99, inStock: true },
				{ sku: "A-200", title: "Budget Headphones", price: 29.99, inStock: true },
			],
		}),
		timestamp: Date.now(),
	}),
];

const storeBEvents: NetworkEvent[] = [
	new NetworkEvent({
		requestId: "b-1",
		url: "https://api.store-b.example.com/products?query=headphones",
		method: "GET",
		resourceType: "fetch",
		requestHeaders: {},
		responseStatus: 200,
		responseHeaders: { "content-type": "application/json" },
		responseBody: JSON.stringify({
			items: [
				{ id: "B-500", name: "Premium Headphones", cost: 89.99, available: true },
				{ id: "B-600", name: "Value Headphones", cost: 24.99, available: false },
			],
		}),
		timestamp: Date.now(),
	}),
];

// --- Scout both stores ---

const stores = [
	{ name: "store-a", events: storeAEvents, url: "https://store-a.example.com" },
	{ name: "store-b", events: storeBEvents, url: "https://store-b.example.com" },
];

const clients: Array<{ name: string; code: string; baseUrl: string }> = [];

for (const store of stores) {
	const layer = Layer.mergeAll(
		Layer.succeed(Browser, makeTestBrowserWithEvents(store.events)),
		Layer.succeed(Store, makeTestStore()),
		SchemaInferrerLive,
		OpenApiGeneratorLive,
	);

	const result = await Effect.runPromise(
		scout({
			url: store.url,
			task: "find product search endpoints",
		}).pipe(Effect.provide(layer)),
	);

	const clientCode = generateClient(result.openApiSpec as object);
	const serverUrl =
		((result.openApiSpec as Record<string, unknown>).servers as Array<{ url: string }>)?.[0]
			?.url ?? store.url;

	clients.push({ name: store.name, code: clientCode, baseUrl: serverUrl });
	console.log(`[${store.name}] Scouted ${result.endpointCount} endpoints`);
}

// --- Build sandbox modules for each store ---
// Each sandbox gets:
//   1. The generated typed client (fetch functions)
//   2. A normalizer that maps store-specific shapes to a common format
//   3. A fetch handler the parent worker calls

const commonTypes = `
/** Normalized product shape shared across all store sandboxes */
interface NormalizedProduct {
  source: string;
  id: string;
  title: string;
  price: number;
  available: boolean;
}
`;

for (const client of clients) {
	// In a real Worker, each of these would be loaded into env.LOADER.get():
	const sandboxModule = `
${client.code}

${commonTypes}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";

    // Call the generated typed function
    const raw = await ${client.name === "store-a" ? "getSearch" : "getProducts"}(${client.name === "store-a" ? "{ q: query }" : "{ query }"});

    // Normalize to common shape
    const items = ${
			client.name === "store-a"
				? 'raw.results.map(r => ({ source: "store-a", id: r.sku, title: r.title, price: r.price, available: r.inStock }))'
				: 'raw.items.map(r => ({ source: "store-b", id: r.id, title: r.name, price: r.cost, available: r.available }))'
		};

    return Response.json(items);
  }
};
`;

	console.log(`\n=== Sandbox module for ${client.name} (${sandboxModule.length} bytes) ===`);
}

// --- Parent Worker orchestration (pseudocode) ---
// In production, the parent Worker loads all sandboxes in parallel:

const orchestratorExample = `
// Parent Worker: load sandboxes and query in parallel
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "headphones";

    // Load each store's sandbox — isolated, can only reach its own API
    const sandboxes = stores.map(store =>
      env.LOADER.get(store.name, async () => ({
        compatibilityDate: "2025-06-01",
        mainModule: "client.js",
        modules: { "client.js": store.sandboxCode },
        // Each sandbox can ONLY reach its target API
        globalOutbound: env.OUTBOUND_PROXY,
      }))
    );

    // Query all stores in parallel
    const results = await Promise.all(
      sandboxes.map(sandbox =>
        sandbox
          .getEntrypoint()
          .fetch("http://sandbox/search?q=" + encodeURIComponent(query))
          .then(r => r.json())
      )
    );

    // Merge, sort by price, return
    const merged = results
      .flat()
      .sort((a, b) => a.price - b.price);

    return Response.json({ query, results: merged });
  }
};
`;

console.log("\n=== Parent Worker orchestrator ===");
console.log(orchestratorExample);

// Output summary
console.log("Pipeline summary:");
console.log(`  ${clients.length} stores scouted`);
console.log(`  ${clients.length} typed clients generated`);
console.log(`  ${clients.length} sandbox modules ready for Worker Loader`);
console.log("  Results normalized to common NormalizedProduct shape");
