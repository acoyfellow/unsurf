import { Context, Effect, Layer } from "effect";
import { NotFoundError, StoreError } from "../domain/Errors.js";
import type { GalleryEntry } from "../domain/Gallery.js";
import type { StoreService } from "./Store.js";
import { Store } from "./Store.js";

// ==================== Service Interface ====================

export interface GalleryService {
	readonly search: (
		query: string,
		domain?: string | undefined,
		limit?: number | undefined,
	) => Effect.Effect<GalleryEntry[], StoreError>;
	readonly publish: (
		siteId: string,
		contributor?: string | undefined,
	) => Effect.Effect<GalleryEntry, StoreError | NotFoundError>;
	readonly getSpec: (
		galleryId: string,
	) => Effect.Effect<Record<string, unknown>, StoreError | NotFoundError>;
	readonly getByDomain: (domain: string) => Effect.Effect<GalleryEntry | null, StoreError>;
}

export class Gallery extends Context.Tag("Gallery")<Gallery, GalleryService>() {}

// ==================== KV Cache Interface ====================

export interface KvCacheService {
	readonly get: (key: string) => Effect.Effect<string | null, StoreError>;
	readonly put: (key: string, value: string, ttlSeconds: number) => Effect.Effect<void, StoreError>;
}

export class KvCache extends Context.Tag("KvCache")<KvCache, KvCacheService>() {}

// ==================== Helpers ==

function generateId(prefix: string): string {
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `${prefix}_${ts}_${rand}`;
}

function nowISO(): string {
	return new Date().toISOString();
}

const CACHE_TTL = 3600; // 1 hour

// ==================== D1 + R2 + KV Live Implementation ====================

export function makeD1Gallery(
	db: D1Database,
	store: StoreService,
	kv?: KvCacheService | undefined,
): GalleryService {
	const tryD1 = <A>(fn: () => Promise<A>) =>
		Effect.tryPromise({
			try: fn,
			catch: (e) => new StoreError({ message: String(e) }),
		});

	const cacheGet = (key: string): Effect.Effect<string | null, StoreError> =>
		kv ? kv.get(key) : Effect.succeed(null);

	const cachePut = (key: string, value: string): Effect.Effect<void, StoreError> =>
		kv ? kv.put(key, value, CACHE_TTL) : Effect.void;

	return {
		search: (query, domain, limit = 10) => {
			const effectiveLimit = Math.min(limit, 50);
			const cacheKey = `q:${query}:${domain ?? ""}:${effectiveLimit}`;

			return cacheGet(cacheKey).pipe(
				Effect.flatMap((cached) => {
					if (cached) {
						return Effect.succeed(JSON.parse(cached) as GalleryEntry[]);
					}

					let sql: string;
					let params: unknown[];

					if (domain && !query) {
						sql = "SELECT * FROM gallery WHERE domain = ? LIMIT ?";
						params = [domain, effectiveLimit];
					} else if (query && !domain) {
						sql =
							"SELECT g.* FROM gallery g JOIN gallery_fts f ON g.rowid = f.rowid WHERE gallery_fts MATCH ? LIMIT ?";
						params = [query, effectiveLimit];
					} else {
						sql =
							"SELECT g.* FROM gallery g JOIN gallery_fts f ON g.rowid = f.rowid WHERE gallery_fts MATCH ? AND g.domain = ? LIMIT ?";
						params = [query, domain, effectiveLimit];
					}

					return tryD1(() =>
						db
							.prepare(sql)
							.bind(...params)
							.all(),
					).pipe(
						Effect.map((result) => mapRows(result.results as unknown as RawGalleryRow[])),
						Effect.tap((results) => cachePut(cacheKey, JSON.stringify(results))),
					);
				}),
			);
		},

		publish: (siteId, contributor = "anonymous") =>
			Effect.gen(function* () {
				// Get site from store
				const site = yield* store.getSite(siteId);
				const endpoints = yield* store.getEndpoints(siteId);

				const endpointsSummary = endpoints.map((ep) => `${ep.method} ${ep.pathPattern}`).join(", ");
				const specKey = `specs/${siteId}/openapi.json`;
				const now = nowISO();

				// Check if domain already exists
				const existing = yield* tryD1(() =>
					db.prepare("SELECT * FROM gallery WHERE domain = ? LIMIT 1").bind(site.domain).first(),
				);

				if (existing) {
					const row = existing as unknown as RawGalleryRow;
					const newVersion = (row.version ?? 1) + 1;
					yield* tryD1(() =>
						db
							.prepare(
								"UPDATE gallery SET url = ?, task = ?, endpoint_count = ?, endpoints_summary = ?, spec_key = ?, contributor = ?, updated_at = ?, version = ? WHERE id = ?",
							)
							.bind(
								site.url,
								endpoints.length > 0 ? endpointsSummary : row.task,
								endpoints.length,
								endpointsSummary,
								specKey,
								contributor,
								now,
								newVersion,
								row.id,
							)
							.run(),
					);

					return mapRow({
						...row,
						url: site.url,
						task: endpoints.length > 0 ? endpointsSummary : row.task,
						endpoint_count: endpoints.length,
						endpoints_summary: endpointsSummary,
						spec_key: specKey,
						contributor,
						updated_at: now,
						version: newVersion,
					});
				}

				// New entry
				const id = generateId("gal");
				const task = endpoints.length > 0 ? endpointsSummary : "no endpoints captured";
				yield* tryD1(() =>
					db
						.prepare(
							"INSERT INTO gallery (id, domain, url, task, endpoint_count, endpoints_summary, spec_key, contributor, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
						)
						.bind(
							id,
							site.domain,
							site.url,
							task,
							endpoints.length,
							endpointsSummary,
							specKey,
							contributor,
							now,
							now,
						)
						.run(),
				);

				return mapRow({
					id,
					domain: site.domain,
					url: site.url,
					task,
					endpoint_count: endpoints.length,
					endpoints_summary: endpointsSummary,
					spec_key: specKey,
					contributor,
					created_at: now,
					updated_at: now,
					version: 1,
				});
			}),

		getSpec: (galleryId) =>
			Effect.gen(function* () {
				const row = yield* tryD1(() =>
					db.prepare("SELECT spec_key FROM gallery WHERE id = ?").bind(galleryId).first(),
				);
				if (!row) {
					return yield* Effect.fail(new NotFoundError({ id: galleryId, resource: "gallery" }));
				}

				const specKey = (row as Record<string, unknown>).spec_key as string;
				const blob = yield* store.getBlob(specKey);
				if (!blob) {
					return yield* Effect.fail(new NotFoundError({ id: specKey, resource: "spec" }));
				}

				const text = new TextDecoder().decode(blob);
				return JSON.parse(text) as Record<string, unknown>;
			}),

		getByDomain: (domain) => {
			const cacheKey = `domain:${domain}`;

			return cacheGet(cacheKey).pipe(
				Effect.flatMap((cached) => {
					if (cached) {
						return Effect.succeed(JSON.parse(cached) as GalleryEntry);
					}

					return tryD1(() =>
						db.prepare("SELECT * FROM gallery WHERE domain = ? LIMIT 1").bind(domain).first(),
					).pipe(
						Effect.map((row) => (row ? mapRow(row as unknown as RawGalleryRow) : null)),
						Effect.tap((result) =>
							result ? cachePut(cacheKey, JSON.stringify(result)) : Effect.void,
						),
					);
				}),
			);
		},
	};
}

// ==================== Row Mapping ====================

interface RawGalleryRow {
	id: string;
	domain: string;
	url: string;
	task: string;
	endpoint_count: number;
	endpoints_summary: string;
	spec_key: string;
	contributor: string | null;
	created_at: string;
	updated_at: string;
	version: number;
}

function mapRow(row: RawGalleryRow): GalleryEntry {
	return {
		id: row.id,
		domain: row.domain,
		url: row.url,
		task: row.task,
		endpointCount: row.endpoint_count,
		endpointsSummary: row.endpoints_summary,
		specKey: row.spec_key,
		contributor: row.contributor ?? "anonymous",
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		version: row.version,
	} as GalleryEntry;
}

function mapRows(rows: RawGalleryRow[]): GalleryEntry[] {
	return rows.map(mapRow);
}

// ==================== In-Memory Test Implementation ====================

export function makeTestGallery(store: StoreService): GalleryService {
	const entries = new Map<string, GalleryEntry>();

	return {
		search: (query, domain, limit = 10) => {
			const effectiveLimit = Math.min(limit, 50);
			const all = [...entries.values()];
			let results: GalleryEntry[];

			if (domain && !query) {
				results = all.filter((e) => e.domain === domain);
			} else if (query && !domain) {
				const q = query.toLowerCase();
				results = all.filter(
					(e) =>
						e.domain.toLowerCase().includes(q) ||
						e.url.toLowerCase().includes(q) ||
						e.task.toLowerCase().includes(q) ||
						e.endpointsSummary.toLowerCase().includes(q),
				);
			} else {
				const q = (query || "").toLowerCase();
				results = all.filter(
					(e) =>
						e.domain === domain &&
						(e.task.toLowerCase().includes(q) || e.endpointsSummary.toLowerCase().includes(q)),
				);
			}

			results = results.slice(0, effectiveLimit);
			return Effect.succeed(results);
		},

		publish: (siteId, contributor = "anonymous") =>
			Effect.gen(function* () {
				const site = yield* store.getSite(siteId);
				const endpoints = yield* store.getEndpoints(siteId);

				const endpointsSummary = endpoints.map((ep) => `${ep.method} ${ep.pathPattern}`).join(", ");
				const specKey = `specs/${siteId}/openapi.json`;
				const now = nowISO();

				// Dedup by domain
				const existing = [...entries.values()].find((e) => e.domain === site.domain);
				if (existing) {
					const updated = {
						...existing,
						url: site.url,
						task: endpoints.length > 0 ? endpointsSummary : existing.task,
						endpointCount: endpoints.length,
						endpointsSummary,
						specKey,
						contributor,
						updatedAt: now,
						version: existing.version + 1,
					} as GalleryEntry;
					entries.set(existing.id, updated);
					return updated;
				}

				const id = generateId("gal");
				const task = endpoints.length > 0 ? endpointsSummary : "no endpoints captured";
				const entry = {
					id,
					domain: site.domain,
					url: site.url,
					task,
					endpointCount: endpoints.length,
					endpointsSummary,
					specKey,
					contributor,
					createdAt: now,
					updatedAt: now,
					version: 1,
				} as GalleryEntry;
				entries.set(id, entry);
				return entry;
			}),

		getSpec: (galleryId) =>
			Effect.gen(function* () {
				const entry = entries.get(galleryId);
				if (!entry) {
					return yield* Effect.fail(new NotFoundError({ id: galleryId, resource: "gallery" }));
				}

				const blob = yield* store.getBlob(entry.specKey);
				if (!blob) {
					return yield* Effect.fail(new NotFoundError({ id: entry.specKey, resource: "spec" }));
				}

				const text = new TextDecoder().decode(blob);
				return JSON.parse(text) as Record<string, unknown>;
			}),

		getByDomain: (domain) => {
			const found = [...entries.values()].find((e) => e.domain === domain) ?? null;
			return Effect.succeed(found);
		},
	};
}

export const GalleryTestLive = (store: StoreService) =>
	Layer.succeed(Gallery, makeTestGallery(store));

export const GalleryD1Live = (
	db: D1Database,
	store: StoreService,
	kv?: KvCacheService | undefined,
) => Layer.succeed(Gallery, makeD1Gallery(db, store, kv));

// ==================== KV Live Implementation ====================

export function makeKvCache(kv: KVNamespace): KvCacheService {
	const tryKv = <A>(fn: () => Promise<A>) =>
		Effect.tryPromise({
			try: fn,
			catch: (e) => new StoreError({ message: String(e) }),
		});

	return {
		get: (key) => tryKv(() => kv.get(key)),
		put: (key, value, ttlSeconds) => tryKv(() => kv.put(key, value, { expirationTtl: ttlSeconds })),
	};
}

export const KvCacheLive = (kv: KVNamespace) => Layer.succeed(KvCache, makeKvCache(kv));
