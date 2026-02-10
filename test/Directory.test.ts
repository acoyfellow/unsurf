import { Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";
import type {
	Capability,
	CapabilitySlice,
	EndpointSummary,
	Fingerprint,
	SearchResult,
} from "../src/domain/Fingerprint.js";
import { NotFoundError, StoreError } from "../src/domain/Errors.js";
import {
	type DirectoryService,
	classifyEndpoint,
	detectAuth,
	generateSummary,
	generateId,
	nowISO,
} from "../src/services/Directory.js";
import { makeTestStore } from "../src/services/Store.js";
import type { StoreService } from "../src/services/Store.js";

// ==================== In-Memory Test Implementation ====================

function makeTestDirectory(store: StoreService): DirectoryService {
	const fingerprints = new Map<string, Fingerprint & { id: string; specKey: string }>();
	const endpoints = new Map<string, EndpointSummary[]>(); // keyed by fingerprintId
	const fpIdByDomain = new Map<string, string>(); // domain -> fingerprintId

	return {
		getFingerprint: (domain) =>
			Effect.sync(() => {
				const fpId = fpIdByDomain.get(domain);
				return fpId ? fingerprints.get(fpId) : undefined;
			}).pipe(
				Effect.flatMap((fp) =>
					fp
						? Effect.succeed(fp as Fingerprint)
						: Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" })),
				),
			),

		getCapabilitySlice: (domain, capability) =>
			Effect.gen(function* () {
				const fpId = fpIdByDomain.get(domain);
				if (!fpId)
					return yield* Effect.fail(
						new NotFoundError({ id: domain, resource: "fingerprint" }),
					);

				const eps = (endpoints.get(fpId) ?? []).filter(
					(ep) => classifyEndpoint(ep.method, ep.path) === capability,
				);

				return {
					domain,
					capability,
					endpoints: eps,
				} as CapabilitySlice;
			}),

		getEndpoint: (domain, method, path) =>
			Effect.gen(function* () {
				const fpId = fpIdByDomain.get(domain);
				if (!fpId)
					return yield* Effect.fail(
						new NotFoundError({ id: domain, resource: "fingerprint" }),
					);

				const eps = endpoints.get(fpId) ?? [];
				const found = eps.find(
					(ep) => ep.method === method.toUpperCase() && ep.path === path,
				);
				if (!found)
					return yield* Effect.fail(
						new NotFoundError({ id: `${method} ${path}`, resource: "endpoint" }),
					);

				return found;
			}),

		getSpec: (domain) =>
			Effect.gen(function* () {
				const fpId = fpIdByDomain.get(domain);
				if (!fpId)
					return yield* Effect.fail(
						new NotFoundError({ id: domain, resource: "fingerprint" }),
					);
				const fp = fingerprints.get(fpId);
				if (!fp)
					return yield* Effect.fail(
						new NotFoundError({ id: domain, resource: "fingerprint" }),
					);

				const blob = yield* store.getBlob(fp.specKey);
				if (!blob)
					return yield* Effect.fail(
						new NotFoundError({ id: domain, resource: "spec" }),
					);

				const text = new TextDecoder().decode(blob);
				return JSON.parse(text) as Record<string, unknown>;
			}),

		search: (query, limit = 10) => {
			const q = query.toLowerCase();
			const results: SearchResult[] = [];

			for (const [fpId, fp] of fingerprints) {
				const eps = endpoints.get(fpId) ?? [];
				for (const ep of eps) {
					const text =
						`${fp.domain} ${ep.method} ${ep.path} ${ep.summary}`.toLowerCase();
					if (text.includes(q)) {
						results.push({
							domain: fp.domain,
							match: `${ep.method} ${ep.path}`,
							capability: classifyEndpoint(ep.method, ep.path),
							confidence: 0.9,
							specUrl: `/d/${fp.domain}/spec`,
						} as SearchResult);
					}
				}
			}

			return Effect.succeed(results.slice(0, limit));
		},

		publish: (siteId, contributor = "anonymous") =>
			Effect.gen(function* () {
				const site = yield* store.getSite(siteId);
				const siteEndpoints = yield* store.getEndpoints(siteId);

				const domain = site.domain;
				const url = site.url;
				const now = nowISO();

				const capabilitySet = new Set<string>();
				const methodCounts: Record<string, number> = {};
				let detectedAuthType = "none";

				const epSummaries: EndpointSummary[] = [];

				for (const ep of siteEndpoints) {
					const cap = classifyEndpoint(ep.method, ep.pathPattern);
					capabilitySet.add(cap);
					methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;

					const summary = generateSummary(ep.method, ep.pathPattern);
					epSummaries.push({
						method: ep.method,
						path: ep.pathPattern,
						summary,
						requestSchema: ep.requestSchema
							? Option.some(ep.requestSchema)
							: Option.none(),
						responseSchema: ep.responseSchema ?? {},
						auth: false,
						example: Option.none(),
					} as EndpointSummary);
				}

				const capabilities = [...capabilitySet];
				const existingFpId = fpIdByDomain.get(domain);

				let fpId: string;
				let version = 1;

				if (existingFpId) {
					fpId = existingFpId;
					const existingFp = fingerprints.get(fpId);
					version = (existingFp?.version ?? 1) + 1;
				} else {
					fpId = generateId("fp");
					fpIdByDomain.set(domain, fpId);
				}

				// Store endpoint summaries
				endpoints.set(fpId, epSummaries);

				const fp = {
					id: fpId,
					domain,
					url,
					endpoints: siteEndpoints.length,
					capabilities,
					methods: methodCounts,
					auth: detectedAuthType as Fingerprint["auth"],
					confidence: 0.9,
					lastScouted: now,
					version,
					specUrl: `/d/${domain}/spec`,
					specKey: `directory/${domain}/openapi.json`,
				};

				fingerprints.set(fpId, fp);

				return fp as Fingerprint;
			}),

		list: (offset = 0, limit = 20) => {
			const all = [...fingerprints.values()]
				.sort(
					(a, b) =>
						new Date(b.lastScouted).getTime() - new Date(a.lastScouted).getTime(),
				)
				.slice(offset, offset + limit);
			return Effect.succeed(all as Fingerprint[]);
		},
	};
}

// ==================== Test Setup ====================

const store = makeTestStore();
const directory = makeTestDirectory(store);
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

// Helper: seed a site with endpoints into the test store
async function seedSite(
	id: string,
	url: string,
	domain: string,
	eps: Array<{
		id: string;
		method: string;
		pathPattern: string;
	}> = [],
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
	if (eps.length > 0) {
		await run(
			store.saveEndpoints(
				eps.map(
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

// ==================== Tests ====================

describe("Directory", () => {
	describe("publish", () => {
		it("creates fingerprint and endpoints from scouted site", async () => {
			await seedSite("site-dir-1", "https://api.example.com", "api.example.com", [
				{ id: "ep-d1", method: "GET", pathPattern: "/users" },
				{ id: "ep-d2", method: "POST", pathPattern: "/users" },
				{ id: "ep-d3", method: "GET", pathPattern: "/users/:id" },
			]);

			const fp = await run(directory.publish("site-dir-1", "alice"));
			expect(fp.domain).toBe("api.example.com");
			expect(fp.url).toBe("https://api.example.com");
			expect(fp.endpoints).toBe(3);
			expect(fp.version).toBe(1);
			expect(fp.confidence).toBe(0.9);
			expect(fp.specUrl).toBe("/d/api.example.com/spec");
			expect(fp.capabilities).toContain("auth"); // /users matches auth pattern
			expect(fp.methods).toHaveProperty("GET");
			expect(fp.methods).toHaveProperty("POST");
			expect(fp.methods.GET).toBe(2);
			expect(fp.methods.POST).toBe(1);
		});

		it("publish twice same domain increments version", async () => {
			// site-dir-1 was already published with domain api.example.com
			const fp2 = await run(directory.publish("site-dir-1", "bob"));
			expect(fp2.domain).toBe("api.example.com");
			expect(fp2.version).toBe(2);
		});

		it("defaults contributor to anonymous", async () => {
			await seedSite("site-dir-anon", "https://anon.example.com", "anon.example.com", [
				{ id: "ep-danon", method: "GET", pathPattern: "/data" },
			]);

			const fp = await run(directory.publish("site-dir-anon"));
			expect(fp.domain).toBe("anon.example.com");
			// No error means it accepted the default contributor
		});

		it("fails with NotFoundError for missing site", async () => {
			const exit = await Effect.runPromiseExit(directory.publish("nonexistent-site"));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("getFingerprint", () => {
		it("returns fingerprint for published domain", async () => {
			const fp = await run(directory.getFingerprint("api.example.com"));
			expect(fp.domain).toBe("api.example.com");
			expect(fp.url).toBe("https://api.example.com");
			expect(fp.endpoints).toBe(3);
			expect(fp.capabilities).toBeDefined();
			expect(fp.methods).toBeDefined();
		});

		it("returns NotFoundError for missing domain", async () => {
			const exit = await Effect.runPromiseExit(
				directory.getFingerprint("nonexistent.example.com"),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("getCapabilitySlice", () => {
		it("returns endpoints filtered by capability", async () => {
			// /users endpoints should be classified as "auth"
			const slice = await run(
				directory.getCapabilitySlice("api.example.com", "auth"),
			);
			expect(slice.domain).toBe("api.example.com");
			expect(slice.capability).toBe("auth");
			expect(slice.endpoints.length).toBeGreaterThan(0);
			for (const ep of slice.endpoints) {
				// All returned endpoints should classify as "auth"
				expect(classifyEndpoint(ep.method, ep.path)).toBe("auth");
			}
		});

		it("returns empty endpoints for unmatched capability", async () => {
			const slice = await run(
				directory.getCapabilitySlice("api.example.com", "payments"),
			);
			expect(slice.domain).toBe("api.example.com");
			expect(slice.capability).toBe("payments");
			expect(slice.endpoints).toHaveLength(0);
		});

		it("returns NotFoundError for missing domain", async () => {
			const exit = await Effect.runPromiseExit(
				directory.getCapabilitySlice("nonexistent.example.com", "auth"),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("getEndpoint", () => {
		it("returns single endpoint detail", async () => {
			const ep = await run(
				directory.getEndpoint("api.example.com", "GET", "/users"),
			);
			expect(ep.method).toBe("GET");
			expect(ep.path).toBe("/users");
			expect(ep.summary).toBeDefined();
			expect(typeof ep.auth).toBe("boolean");
		});

		it("returns NotFoundError for missing endpoint", async () => {
			const exit = await Effect.runPromiseExit(
				directory.getEndpoint("api.example.com", "DELETE", "/nonexistent"),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});

		it("returns NotFoundError for missing domain", async () => {
			const exit = await Effect.runPromiseExit(
				directory.getEndpoint("nonexistent.example.com", "GET", "/users"),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("search", () => {
		it("finds endpoints matching query", async () => {
			const results = await run(directory.search("users"));
			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.domain === "api.example.com")).toBe(true);
		});

		it("returns empty for non-matching query", async () => {
			const results = await run(directory.search("zzz-no-match-xyz"));
			expect(results).toHaveLength(0);
		});

		it("respects limit parameter", async () => {
			// Seed multiple sites with matching endpoints
			for (let i = 0; i < 5; i++) {
				await seedSite(
					`site-dir-search-${i}`,
					`https://search${i}.example.com`,
					`search${i}.example.com`,
					[{ id: `ep-search-${i}`, method: "GET", pathPattern: "/items" }],
				);
				await run(directory.publish(`site-dir-search-${i}`));
			}

			const results = await run(directory.search("items", 2));
			expect(results.length).toBeLessThanOrEqual(2);
		});

		it("search results include capability and specUrl", async () => {
			const results = await run(directory.search("users"));
			const result = results[0];
			expect(result).toBeDefined();
			expect(result!.capability).toBeDefined();
			expect(result!.specUrl).toMatch(/^\/d\//);
			expect(result!.confidence).toBeGreaterThan(0);
		});
	});

	describe("list", () => {
		it("returns paginated fingerprints", async () => {
			const fps = await run(directory.list());
			expect(fps.length).toBeGreaterThan(0);
			for (const fp of fps) {
				expect(fp.domain).toBeDefined();
				expect(fp.url).toBeDefined();
				expect(fp.endpoints).toBeGreaterThanOrEqual(0);
			}
		});

		it("respects offset and limit", async () => {
			const all = await run(directory.list(0, 100));
			const page1 = await run(directory.list(0, 2));
			const page2 = await run(directory.list(2, 2));

			expect(page1.length).toBeLessThanOrEqual(2);
			expect(page2.length).toBeLessThanOrEqual(2);

			// Pages should not overlap (if we have enough data)
			if (all.length > 2) {
				const page1Domains = page1.map((fp) => fp.domain);
				const page2Domains = page2.map((fp) => fp.domain);
				for (const d of page2Domains) {
					expect(page1Domains).not.toContain(d);
				}
			}
		});

		it("returns empty when offset exceeds data", async () => {
			const fps = await run(directory.list(10000, 20));
			expect(fps).toHaveLength(0);
		});
	});

	describe("classifyEndpoint helper", () => {
		it("classifies auth endpoints", () => {
			expect(classifyEndpoint("POST", "/auth/login")).toBe("auth");
			expect(classifyEndpoint("POST", "/api/register")).toBe("auth");
			expect(classifyEndpoint("GET", "/users/me")).toBe("auth");
		});

		it("classifies payments endpoints", () => {
			expect(classifyEndpoint("POST", "/pay/charge")).toBe("payments");
			expect(classifyEndpoint("GET", "/billing/invoices")).toBe("payments");
		});

		it("classifies content endpoints", () => {
			expect(classifyEndpoint("GET", "/posts/latest")).toBe("content");
			expect(classifyEndpoint("GET", "/articles/1")).toBe("content");
		});

		it("classifies search endpoints", () => {
			expect(classifyEndpoint("GET", "/search?q=test")).toBe("search");
		});

		it("classifies ecommerce endpoints", () => {
			expect(classifyEndpoint("GET", "/products/1")).toBe("ecommerce");
			expect(classifyEndpoint("POST", "/cart/add")).toBe("ecommerce");
		});

		it("falls back to other for unknown paths", () => {
			expect(classifyEndpoint("GET", "/health")).toBe("other");
			expect(classifyEndpoint("GET", "/version")).toBe("other");
		});
	});

	describe("detectAuth helper", () => {
		it("detects bearer auth", () => {
			expect(detectAuth({ authorization: "Bearer token123" })).toBe("bearer");
		});

		it("detects basic auth", () => {
			expect(detectAuth({ authorization: "Basic dXNlcjpwYXNz" })).toBe("basic");
		});

		it("detects api-key auth", () => {
			expect(detectAuth({ "x-api-key": "key123" })).toBe("api-key");
		});

		it("detects cookie auth", () => {
			expect(detectAuth({ cookie: "session=abc" })).toBe("cookie");
		});

		it("returns none for no auth headers", () => {
			expect(detectAuth({ "content-type": "application/json" })).toBe("none");
		});

		it("returns unknown for null headers", () => {
			expect(detectAuth(null)).toBe("unknown");
		});
	});

	describe("generateSummary helper", () => {
		it("generates GET list summary", () => {
			expect(generateSummary("GET", "/users")).toBe("List userss");
		});

		it("generates GET by ID summary", () => {
			expect(generateSummary("GET", "/users/:id")).toBe("Get users by ID");
		});

		it("generates POST summary", () => {
			expect(generateSummary("POST", "/users")).toBe("Create users");
		});

		it("generates PUT summary", () => {
			expect(generateSummary("PUT", "/users/:id")).toBe("Update users");
		});

		it("generates DELETE summary", () => {
			expect(generateSummary("DELETE", "/users/:id")).toBe("Delete users");
		});
	});
});
