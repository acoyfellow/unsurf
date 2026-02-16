import { Context, Effect, Layer, Option } from "effect";
import { NotFoundError, StoreError } from "../domain/Errors.js";
import type {
	Capability,
	CapabilitySlice,
	EndpointSummary,
	Fingerprint,
	SearchResult,
} from "../domain/Fingerprint.js";
import type { StoreService } from "./Store.js";

// ==================== Service Interface ====================

export interface DirectoryService {
	/** Get fingerprint for a domain (~50 tokens) */
	getFingerprint: (domain: string) => Effect.Effect<Fingerprint, NotFoundError | StoreError>;

	/** Get endpoints by capability (~200 tokens) */
	getCapabilitySlice: (
		domain: string,
		capability: Capability,
	) => Effect.Effect<CapabilitySlice, NotFoundError | StoreError>;

	/** Get single endpoint detail (~80 tokens) */
	getEndpoint: (
		domain: string,
		method: string,
		path: string,
	) => Effect.Effect<EndpointSummary, NotFoundError | StoreError>;

	/** Get full OpenAPI spec (expensive) */
	getSpec: (domain: string) => Effect.Effect<Record<string, unknown>, NotFoundError | StoreError>;

	/** Semantic search across all APIs */
	search: (query: string, limit?: number) => Effect.Effect<SearchResult[], StoreError>;

	/** Publish a scouted site to the directory */
	publish: (
		siteId: string,
		contributor?: string,
	) => Effect.Effect<Fingerprint, NotFoundError | StoreError>;

	/** List all domains (paginated) */
	list: (offset?: number, limit?: number) => Effect.Effect<Fingerprint[], StoreError>;
}

export class Directory extends Context.Tag("Directory")<Directory, DirectoryService>() {}

// ==================== Helpers ====================

function generateId(prefix: string): string {
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `${prefix}_${ts}_${rand}`;
}

function nowISO(): string {
	return new Date().toISOString();
}

// Capability classification rules
const CAPABILITY_PATTERNS: Record<Capability, RegExp[]> = {
	auth: [
		/\/auth/i,
		/\/login/i,
		/\/logout/i,
		/\/register/i,
		/\/users?\//i,
		/\/session/i,
		/\/oauth/i,
	],
	payments: [/\/pay/i, /\/charge/i, /\/invoice/i, /\/subscription/i, /\/billing/i, /\/stripe/i],
	content: [/\/posts?\//i, /\/articles?\//i, /\/comments?\//i, /\/feed/i, /\/blog/i],
	crud: [/\/api\/v?\d*\//i],
	search: [/\/search/i, /\/query/i, /\/find/i],
	messaging: [/\/messages?\//i, /\/chat/i, /\/notifications?\//i, /\/email/i],
	files: [/\/files?\//i, /\/upload/i, /\/download/i, /\/media/i, /\/images?\//i],
	analytics: [/\/analytics/i, /\/metrics/i, /\/stats/i, /\/events/i, /\/track/i],
	social: [/\/friends?\//i, /\/follow/i, /\/like/i, /\/share/i, /\/profile/i],
	ecommerce: [/\/cart/i, /\/products?\//i, /\/orders?\//i, /\/checkout/i, /\/inventory/i],
	forms: [/\/contact/i, /\/form/i, /\/submit/i, /\/inquiry/i],
	other: [],
};

function classifyEndpoint(method: string, path: string): Capability {
	for (const [cap, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
		if (cap === "other") continue;
		for (const pattern of patterns) {
			if (pattern.test(path)) return cap as Capability;
		}
	}
	return "other";
}

function detectAuth(headers: Record<string, string> | null): string {
	if (!headers) return "unknown";
	const authHeader = headers.authorization || headers.Authorization || "";
	if (authHeader.toLowerCase().startsWith("bearer")) return "bearer";
	if (authHeader.toLowerCase().startsWith("basic")) return "basic";
	if (headers["x-api-key"] || headers["X-Api-Key"]) return "api-key";
	if (headers.cookie || headers.Cookie) return "cookie";
	return "none";
}

function generateSummary(method: string, path: string): string {
	const parts = path.split("/").filter(Boolean);
	const resource = parts.find((p) => !p.startsWith(":") && !p.match(/^[a-f0-9-]+$/i)) || "resource";
	const hasId = parts.some((p) => p.startsWith(":") || p.match(/^[a-f0-9-]+$/i));

	switch (method.toUpperCase()) {
		case "GET":
			return hasId ? `Get ${resource} by ID` : `List ${resource}s`;
		case "POST":
			return `Create ${resource}`;
		case "PUT":
		case "PATCH":
			return `Update ${resource}`;
		case "DELETE":
			return `Delete ${resource}`;
		default:
			return `${method} ${resource}`;
	}
}

export { classifyEndpoint, detectAuth, generateSummary, generateId, nowISO };
export type { Capability };

// ==================== Types for CF bindings ====================

// Use 'any' to bypass CF worker type mismatches between local and deployed types
// biome-ignore lint/suspicious/noExplicitAny: CF binding types vary between environments
type VectorizeBinding = any;
// biome-ignore lint/suspicious/noExplicitAny: CF binding types vary between environments
type AiBinding = any;

// ==================== D1 + Vectorize Implementation ====================

export function makeD1Directory(
	db: D1Database,
	storage: R2Bucket,
	vectors: VectorizeBinding,
	ai: AiBinding,
): DirectoryService {
	const tryD1 = <A>(fn: () => Promise<A>) =>
		Effect.tryPromise({
			try: fn,
			catch: (e) => new StoreError({ message: String(e) }),
		});

	return {
		getFingerprint: (domain) =>
			tryD1(() =>
				db.prepare("SELECT * FROM fingerprints WHERE domain = ?").bind(domain).first(),
			).pipe(
				Effect.flatMap((row) =>
					row
						? Effect.succeed(rowToFingerprint(row as unknown as RawFingerprintRow))
						: Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" })),
				),
			),

		getCapabilitySlice: (domain, capability) =>
			Effect.gen(function* () {
				const fp = yield* tryD1(() =>
					db.prepare("SELECT id FROM fingerprints WHERE domain = ?").bind(domain).first(),
				);
				if (!fp)
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));

				const rows = yield* tryD1(() =>
					db
						.prepare(
							"SELECT * FROM directory_endpoints WHERE fingerprint_id = ? AND capability = ?",
						)
						.bind((fp as { id: string }).id, capability)
						.all(),
				);

				return {
					domain,
					capability,
					endpoints: (rows.results as unknown as RawEndpointRow[]).map(rowToEndpointSummary),
				} as CapabilitySlice;
			}),

		getEndpoint: (domain, method, path) =>
			Effect.gen(function* () {
				const fp = yield* tryD1(() =>
					db.prepare("SELECT id FROM fingerprints WHERE domain = ?").bind(domain).first(),
				);
				if (!fp)
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));

				const row = yield* tryD1(() =>
					db
						.prepare(
							"SELECT * FROM directory_endpoints WHERE fingerprint_id = ? AND method = ? AND path = ?",
						)
						.bind((fp as { id: string }).id, method.toUpperCase(), path)
						.first(),
				);

				if (!row)
					return yield* Effect.fail(
						new NotFoundError({ id: `${method} ${path}`, resource: "endpoint" }),
					);

				return rowToEndpointSummary(row as unknown as RawEndpointRow);
			}),

		getSpec: (domain) =>
			Effect.gen(function* () {
				const fp = yield* tryD1(() =>
					db.prepare("SELECT spec_key FROM fingerprints WHERE domain = ?").bind(domain).first(),
				);
				if (!fp)
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));

				const obj = yield* tryD1(() => storage.get((fp as { spec_key: string }).spec_key));
				if (!obj) return yield* Effect.fail(new NotFoundError({ id: domain, resource: "spec" }));

				const text = yield* tryD1(() => obj.text());
				return JSON.parse(text) as Record<string, unknown>;
			}),

		search: (query, limit = 10) =>
			Effect.gen(function* () {
				// Generate embedding for query
				const embedding = (yield* tryD1(() =>
					ai.run("@cf/baai/bge-base-en-v1.5", { text: [query] }),
				)) as { data: number[][] };

				const queryVector = embedding.data[0];
				if (!queryVector) return [];

				// Search Vectorize
				const results = (yield* tryD1(() =>
					vectors.query(queryVector, { topK: limit, returnMetadata: true }),
				)) as { matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> };

				return results.matches.map((m) => ({
					domain: (m.metadata?.domain as string) || "",
					match: (m.metadata?.match as string) || "",
					capability: (m.metadata?.capability as Capability) || "other",
					confidence: m.score,
					specUrl: `/d/${m.metadata?.domain}/spec`,
				})) as SearchResult[];
			}),

		publish: (siteId, contributor = "anonymous") =>
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-step DB operation
			Effect.gen(function* () {
				// Get site and endpoints from existing store
				const site = yield* tryD1(() =>
					db.prepare("SELECT * FROM sites WHERE id = ?").bind(siteId).first(),
				);
				if (!site) return yield* Effect.fail(new NotFoundError({ id: siteId, resource: "site" }));

				const endpointRows = yield* tryD1(() =>
					db.prepare("SELECT * FROM endpoints WHERE site_id = ?").bind(siteId).all(),
				);
				const endpoints = endpointRows.results as unknown as RawScoutedEndpoint[];

				const domain = (site as { domain: string }).domain;
				const url = (site as { url: string }).url;
				const now = nowISO();

				// Classify endpoints and compute stats
				const capabilitySet = new Set<string>();
				const methodCounts: Record<string, number> = {};
				let detectedAuth = "none";

				for (const ep of endpoints) {
					const cap = classifyEndpoint(ep.method, ep.path_pattern);
					capabilitySet.add(cap);
					methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
					if (ep.request_headers) {
						const auth = detectAuth(JSON.parse(ep.request_headers));
						if (auth !== "none" && auth !== "unknown") detectedAuth = auth;
					}
				}

				const capabilities = [...capabilitySet] as Capability[];
				const specKey = `directory/${domain}/openapi.json`;

				// Check if fingerprint exists
				const existing = yield* tryD1(() =>
					db.prepare("SELECT * FROM fingerprints WHERE domain = ?").bind(domain).first(),
				);

				let fingerprintId: string;
				let version = 1;

				if (existing) {
					fingerprintId = (existing as { id: string }).id;
					version = ((existing as { version: number }).version || 1) + 1;
					yield* tryD1(() =>
						db
							.prepare(
								"UPDATE fingerprints SET url=?, endpoint_count=?, capabilities=?, methods=?, auth=?, confidence=?, updated_at=?, version=? WHERE id=?",
							)
							.bind(
								url,
								endpoints.length,
								JSON.stringify(capabilities),
								JSON.stringify(methodCounts),
								detectedAuth,
								90,
								now,
								version,
								fingerprintId,
							)
							.run(),
					);

					// Delete old endpoints
					yield* tryD1(() =>
						db
							.prepare("DELETE FROM directory_endpoints WHERE fingerprint_id = ?")
							.bind(fingerprintId)
							.run(),
					);
				} else {
					fingerprintId = generateId("fp");
					yield* tryD1(() =>
						db
							.prepare(
								"INSERT INTO fingerprints (id, domain, url, endpoint_count, capabilities, methods, auth, confidence, spec_key, contributor, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
							)
							.bind(
								fingerprintId,
								domain,
								url,
								endpoints.length,
								JSON.stringify(capabilities),
								JSON.stringify(methodCounts),
								detectedAuth,
								90,
								specKey,
								contributor,
								now,
								now,
								1,
							)
							.run(),
					);
				}

				// Insert directory endpoints + vectors
				const vectorsToInsert: VectorizeVector[] = [];
				const embeddingTexts: string[] = [];

				for (const ep of endpoints) {
					const epId = generateId("ep");
					const cap = classifyEndpoint(ep.method, ep.path_pattern);
					const summary = generateSummary(ep.method, ep.path_pattern);
					const vectorId = generateId("vec");

					yield* tryD1(() =>
						db
							.prepare(
								"INSERT INTO directory_endpoints (id, fingerprint_id, method, path, summary, capability, request_schema, response_schema, auth, vector_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
							)
							.bind(
								epId,
								fingerprintId,
								ep.method,
								ep.path_pattern,
								summary,
								cap,
								ep.request_schema,
								ep.response_schema,
								ep.request_headers ? 1 : 0,
								vectorId,
							)
							.run(),
					);

					// Prepare embedding text
					const embeddingText = `${domain} ${ep.method} ${ep.path_pattern} ${summary} ${cap}`;
					embeddingTexts.push(embeddingText);
					vectorsToInsert.push({
						id: vectorId,
						values: [], // Will be filled below
						metadata: {
							domain,
							match: `${ep.method} ${ep.path_pattern}`,
							capability: cap,
						},
					});
				}

				// Generate embeddings in batch and insert to Vectorize
				if (vectorsToInsert.length > 0) {
					const embeddings = (yield* tryD1(() =>
						ai.run("@cf/baai/bge-base-en-v1.5", { text: embeddingTexts }),
					)) as { data: number[][] };

					for (let i = 0; i < vectorsToInsert.length; i++) {
						const vec = vectorsToInsert[i];
						if (vec) vec.values = embeddings.data[i] ?? [];
					}

					yield* tryD1(() => vectors.insert(vectorsToInsert));
				}

				// Copy the OpenAPI spec from scout storage to directory storage
				const scoutSpecKey = `specs/${siteId}/openapi.json`;
				const specObj = yield* tryD1(() => storage.get(scoutSpecKey));
				if (specObj) {
					const specBody = yield* tryD1(() => specObj.arrayBuffer());
					yield* tryD1(() => storage.put(specKey, specBody));
				}

				return {
					domain,
					url,
					endpoints: endpoints.length,
					capabilities,
					methods: methodCounts,
					auth: detectedAuth,
					confidence: 0.9,
					lastScouted: now,
					version,
					specUrl: `/d/${domain}/spec`,
				} as Fingerprint;
			}),

		list: (offset = 0, limit = 20) =>
			tryD1(() =>
				db
					.prepare("SELECT * FROM fingerprints ORDER BY updated_at DESC LIMIT ? OFFSET ?")
					.bind(limit, offset)
					.all(),
			).pipe(
				Effect.map((result) =>
					(result.results as unknown as RawFingerprintRow[]).map(rowToFingerprint),
				),
			),
	};
}

// ==================== Row mapping ====================

interface RawFingerprintRow {
	id: string;
	domain: string;
	url: string;
	endpoint_count: number;
	capabilities: string;
	methods: string;
	auth: string;
	confidence: number;
	spec_key: string;
	contributor: string | null;
	created_at: string;
	updated_at: string;
	version: number;
}

interface RawEndpointRow {
	id: string;
	fingerprint_id: string;
	method: string;
	path: string;
	summary: string;
	capability: string;
	request_schema: string | null;
	response_schema: string | null;
	auth: number;
	example_request: string | null;
	example_response: string | null;
	vector_id: string | null;
}

interface RawScoutedEndpoint {
	id: string;
	site_id: string;
	method: string;
	path_pattern: string;
	request_schema: string | null;
	response_schema: string | null;
	request_headers: string | null;
	response_headers: string | null;
}

function rowToFingerprint(row: RawFingerprintRow): Fingerprint {
	return {
		domain: row.domain,
		url: row.url,
		endpoints: row.endpoint_count,
		capabilities: JSON.parse(row.capabilities),
		methods: JSON.parse(row.methods),
		auth: row.auth as Fingerprint["auth"],
		confidence: row.confidence / 100,
		lastScouted: row.updated_at,
		version: row.version,
		specUrl: `/d/${row.domain}/spec`,
	} as Fingerprint;
}

function rowToEndpointSummary(row: RawEndpointRow): EndpointSummary {
	return {
		method: row.method,
		path: row.path,
		summary: row.summary,
		requestSchema: row.request_schema ? Option.some(JSON.parse(row.request_schema)) : Option.none(),
		responseSchema: row.response_schema ? JSON.parse(row.response_schema) : {},
		auth: row.auth === 1,
		example:
			row.example_request || row.example_response
				? Option.some({
						request: row.example_request ? JSON.parse(row.example_request) : null,
						response: row.example_response ? JSON.parse(row.example_response) : null,
					})
				: Option.none(),
	} as EndpointSummary;
}

// ==================== Layer ====================

export const DirectoryD1Live = (
	db: D1Database,
	storage: R2Bucket,
	vectors: VectorizeBinding,
	ai: AiBinding,
) => Layer.succeed(Directory, makeD1Directory(db, storage, vectors, ai));

// ==================== In-Memory Test Implementation ====================

export function makeTestDirectory(store: StoreService): DirectoryService {
	const fingerprints = new Map<string, Fingerprint & { id: string; specKey: string }>();
	const directoryEndpoints = new Map<string, EndpointSummary[]>();
	const fpIdByDomain = new Map<string, string>();

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
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));

				const eps = (directoryEndpoints.get(fpId) ?? []).filter(
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
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));

				const eps = directoryEndpoints.get(fpId) ?? [];
				const found = eps.find((ep) => ep.method === method.toUpperCase() && ep.path === path);
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
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));
				const fp = fingerprints.get(fpId);
				if (!fp)
					return yield* Effect.fail(new NotFoundError({ id: domain, resource: "fingerprint" }));

				const blob = yield* store.getBlob(fp.specKey);
				if (!blob) return yield* Effect.fail(new NotFoundError({ id: domain, resource: "spec" }));

				const text = new TextDecoder().decode(blob);
				return JSON.parse(text) as Record<string, unknown>;
			}),

		search: (query, limit = 10) => {
			const q = query.toLowerCase();
			const results: SearchResult[] = [];

			for (const [fpId, fp] of fingerprints) {
				const eps = directoryEndpoints.get(fpId) ?? [];
				for (const ep of eps) {
					const text = `${fp.domain} ${ep.method} ${ep.path} ${ep.summary}`.toLowerCase();
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
				const detectedAuthType = "none";

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
						requestSchema: ep.requestSchema ? Option.some(ep.requestSchema) : Option.none(),
						responseSchema: ep.responseSchema ?? {},
						auth: false,
						example: Option.none(),
					} as EndpointSummary);
				}

				const capabilities = [...capabilitySet] as Capability[];
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
				directoryEndpoints.set(fpId, epSummaries);

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
				.sort((a, b) => new Date(b.lastScouted).getTime() - new Date(a.lastScouted).getTime())
				.slice(offset, offset + limit);
			return Effect.succeed(all as Fingerprint[]);
		},
	};
}

export const DirectoryTestLive = (store: StoreService) =>
	Layer.succeed(Directory, makeTestDirectory(store));
