/**
 * Gallery search — search, publish, and check cached results in the API gallery.
 * This file is embedded in the docs and tested in CI.
 */
import { Effect, Option } from "effect";
import { CapturedEndpoint, type GalleryEntry, Site, makeTestGallery, makeTestStore } from "unsurf";

// ── 1. Set up test doubles ─────────────────────────────────────────────────
const store = makeTestStore();
const gallery = makeTestGallery(store);

// ── 2. Seed the store with a scouted site + endpoints ──────────────────────
const site = new Site({
	id: "site_demo",
	url: "https://api.example.com",
	domain: "api.example.com",
	firstScoutedAt: new Date().toISOString(),
	lastScoutedAt: new Date().toISOString(),
});

const endpoints = [
	new CapturedEndpoint({
		id: "ep_1",
		siteId: "site_demo",
		method: "GET",
		pathPattern: "/users",
		requestSchema: Option.none(),
		responseSchema: Option.some({
			type: "array",
			items: { type: "object", properties: { id: { type: "integer" } } },
		}),
		sampleCount: 5,
		firstSeenAt: new Date().toISOString(),
		lastSeenAt: new Date().toISOString(),
	}),
	new CapturedEndpoint({
		id: "ep_2",
		siteId: "site_demo",
		method: "POST",
		pathPattern: "/users",
		requestSchema: Option.some({ type: "object", properties: { name: { type: "string" } } }),
		responseSchema: Option.some({ type: "object", properties: { id: { type: "integer" } } }),
		sampleCount: 2,
		firstSeenAt: new Date().toISOString(),
		lastSeenAt: new Date().toISOString(),
	}),
];

await Effect.runPromise(store.saveSite(site));
await Effect.runPromise(store.saveEndpoints(endpoints));

// ── 3. Publish to the gallery ──────────────────────────────────────────────
const published: GalleryEntry = await Effect.runPromise(gallery.publish("site_demo", "demo-user"));
console.log(
	`Published: ${published.domain} (${published.endpointCount} endpoints, v${published.version})`,
);
// → Published: api.example.com (2 endpoints, v1)

// ── 4. Search the gallery ──────────────────────────────────────────────────
const results: GalleryEntry[] = await Effect.runPromise(gallery.search("example"));
console.log(`Search returned ${results.length} result(s)`);
// → Search returned 1 result(s)

// ── 5. Check for a cached domain (skip scouting if found) ─────────────────
const cached: GalleryEntry | null = await Effect.runPromise(gallery.getByDomain("api.example.com"));
if (cached) {
	console.log(`Cache hit: ${cached.domain} — skip the browser`);
} else {
	console.log("Cache miss — scout the site");
}
// → Cache hit: api.example.com — skip the browser

// ── 6. Re-publish bumps the version ────────────────────────────────────────
const updated: GalleryEntry = await Effect.runPromise(gallery.publish("site_demo", "another-user"));
console.log(`Updated: v${updated.version}`);
// → Updated: v2

export { gallery, store, published, results, cached, updated };
