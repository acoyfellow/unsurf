import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { makeTestDirectory } from "../src/services/Directory.js";
import { makeTestStore } from "../src/services/Store.js";

const store = makeTestStore();
const directory = makeTestDirectory(store);
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

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

describe("Directory", () => {
	it("getFingerprint returns NotFoundError for missing domain", async () => {
		const exit = await Effect.runPromiseExit(
			directory.getFingerprint("nonexistent.example.com"),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("publish creates a fingerprint from a scouted site", async () => {
		await seedSite("site-dir-1", "https://api.example.com", "api.example.com", [
			{ id: "ep-d1", method: "GET", pathPattern: "/users" },
			{ id: "ep-d2", method: "POST", pathPattern: "/users" },
		]);

		const fp = await run(directory.publish("site-dir-1", "alice"));
		expect(fp.domain).toBe("api.example.com");
		expect(fp.url).toBe("https://api.example.com");
		expect(fp.endpoints).toBe(2);
		expect(fp.version).toBe(1);
		expect(fp.specUrl).toBe("/d/api.example.com/spec");
		expect(fp.methods.GET).toBe(1);
		expect(fp.methods.POST).toBe(1);
	});

	it("getFingerprint returns published fingerprint", async () => {
		const fp = await run(directory.getFingerprint("api.example.com"));
		expect(fp.domain).toBe("api.example.com");
		expect(fp.endpoints).toBe(2);
	});

	it("list returns fingerprints", async () => {
		const fps = await run(directory.list());
		expect(fps.length).toBeGreaterThan(0);
		expect(fps[0]?.domain).toBe("api.example.com");
	});
});
