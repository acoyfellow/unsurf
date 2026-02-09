import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type { GalleryEntry } from "../src/domain/Gallery.js";
import { makeTestGallery } from "../src/services/Gallery.js";
import { makeTestStore } from "../src/services/Store.js";

const store = makeTestStore();
const gallery = makeTestGallery(store);
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

// Helper: seed a site with endpoints into the test store
async function seedSite(
	id: string,
	url: string,
	domain: string,
	endpoints: Array<{ id: string; method: string; pathPattern: string }> = [],
) {
	await run(
		store.saveSite({
			id,
			url,
			domain,
			firstScoutedAt: "2025-01-01T00:00:00Z",
			lastScoutedAt: "2025-01-01T00:00:00Z",
		}),
	);
	if (endpoints.length > 0) {
		await run(
			store.saveEndpoints(
				endpoints.map(
					(ep) =>
						({
							id: ep.id,
							siteId: id,
							method: ep.method as "GET" | "POST",
							pathPattern: ep.pathPattern,
							requestSchema: undefined,
							responseSchema: { type: "object" },
							sampleCount: 1,
							firstSeenAt: "2025-01-01T00:00:00Z",
							lastSeenAt: "2025-01-01T00:00:00Z",
							// biome-ignore lint/suspicious/noExplicitAny: test data
						}) as any,
				),
			),
		);
	}
}

describe("Gallery", () => {
	describe("publish", () => {
		it("creates a new gallery entry", async () => {
			await seedSite("site-gal-1", "https://api.example.com", "api.example.com", [
				{ id: "ep-g1", method: "GET", pathPattern: "/users" },
				{ id: "ep-g2", method: "POST", pathPattern: "/users" },
			]);

			const entry = await run(gallery.publish("site-gal-1", "alice"));
			expect(entry.domain).toBe("api.example.com");
			expect(entry.url).toBe("https://api.example.com");
			expect(entry.endpointCount).toBe(2);
			expect(entry.contributor).toBe("alice");
			expect(entry.version).toBe(1);
			expect(entry.id).toMatch(/^gal_/);
			expect(entry.specKey).toBe("specs/site-gal-1/openapi.json");
		});

		it("publish twice same domain → updates and increments version", async () => {
			// The site-gal-1 was already published above with domain api.example.com
			// Publish again with same site (same domain)
			const entry2 = await run(gallery.publish("site-gal-1", "bob"));
			expect(entry2.domain).toBe("api.example.com");
			expect(entry2.version).toBe(2);
			expect(entry2.contributor).toBe("bob");
		});

		it("publish with no contributor defaults to anonymous", async () => {
			await seedSite("site-gal-anon", "https://anon.example.com", "anon.example.com", [
				{ id: "ep-ganon", method: "GET", pathPattern: "/data" },
			]);

			const entry = await run(gallery.publish("site-gal-anon"));
			expect(entry.contributor).toBe("anonymous");
		});

		it("fails with NotFoundError for missing site", async () => {
			const exit = await Effect.runPromiseExit(gallery.publish("nonexistent-site"));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("search", () => {
		it("search by domain → finds exact match", async () => {
			const results = await run(gallery.search("", "api.example.com"));
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0]?.domain).toBe("api.example.com");
		});

		it("search by keyword → finds matches in text fields", async () => {
			// Seed a distinctive site
			await seedSite("site-gal-weather", "https://weather.io", "weather.io", [
				{ id: "ep-weather", method: "GET", pathPattern: "/forecast" },
			]);
			await run(gallery.publish("site-gal-weather", "carol"));

			const results = await run(gallery.search("forecast"));
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results.some((e) => e.domain === "weather.io")).toBe(true);
		});

		it("search with both query and domain", async () => {
			const results = await run(gallery.search("forecast", "weather.io"));
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results.every((e) => e.domain === "weather.io")).toBe(true);
		});

		it("search returns empty for non-matching query", async () => {
			const results = await run(gallery.search("zzz-no-match-xyz"));
			expect(results).toHaveLength(0);
		});

		it("respects limit parameter", async () => {
			// Seed multiple sites
			for (let i = 0; i < 5; i++) {
				await seedSite(`site-gal-lim-${i}`, `https://limited${i}.com`, `limited${i}.com`, [
					{ id: `ep-lim-${i}`, method: "GET", pathPattern: "/api" },
				]);
				await run(gallery.publish(`site-gal-lim-${i}`));
			}

			const results = await run(gallery.search("api", undefined, 2));
			expect(results.length).toBeLessThanOrEqual(2);
		});
	});

	describe("getByDomain", () => {
		it("returns entry for existing domain", async () => {
			const entry = await run(gallery.getByDomain("api.example.com"));
			expect(entry).not.toBeNull();
			expect(entry?.domain).toBe("api.example.com");
		});

		it("returns null for non-existing domain", async () => {
			const entry = await run(gallery.getByDomain("nonexistent.example.com"));
			expect(entry).toBeNull();
		});
	});

	describe("getSpec", () => {
		it("fetches spec from store blob", async () => {
			// First publish to get the entry
			await seedSite("site-gal-spec", "https://spec.example.com", "spec.example.com", [
				{ id: "ep-spec", method: "GET", pathPattern: "/items" },
			]);
			const entry = await run(gallery.publish("site-gal-spec", "dave"));

			// Store a spec blob at the expected key
			const specData = { openapi: "3.0.0", info: { title: "Spec API" } };
			await run(store.saveBlob(entry.specKey, new TextEncoder().encode(JSON.stringify(specData))));

			const spec = await run(gallery.getSpec(entry.id));
			expect(spec).toEqual(specData);
		});

		it("returns NotFoundError for missing gallery entry", async () => {
			const exit = await Effect.runPromiseExit(gallery.getSpec("nonexistent-gal"));
			expect(Exit.isFailure(exit)).toBe(true);
		});

		it("returns NotFoundError when spec blob is missing", async () => {
			// Publish entry but don't store the blob
			await seedSite("site-gal-noblob", "https://noblob.example.com", "noblob.example.com", [
				{ id: "ep-noblob", method: "GET", pathPattern: "/things" },
			]);
			const entry = await run(gallery.publish("site-gal-noblob"));

			const exit = await Effect.runPromiseExit(gallery.getSpec(entry.id));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});
