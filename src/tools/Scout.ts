import { Effect, Option } from "effect";
import { CapturedEndpoint } from "../domain/Endpoint.js";
import type { BrowserError } from "../domain/Errors.js";
import type { StoreError } from "../domain/Errors.js";
import { ValidationError } from "../domain/Errors.js";
import type { NetworkEvent } from "../domain/NetworkEvent.js";
import { isApiRequest } from "../domain/NetworkEvent.js";
import { PathStep, ScoutedPath } from "../domain/Path.js";
import { Site } from "../domain/Site.js";
import { extractDomain, normalizeUrlPattern } from "../lib/url.js";
import { Browser } from "../services/Browser.js";
import { Directory } from "../services/Directory.js";
import { Gallery } from "../services/Gallery.js";
import { OpenApiGenerator } from "../services/OpenApiGenerator.js";
import { SchemaInferrer } from "../services/SchemaInferrer.js";
import { Store } from "../services/Store.js";

// ==================== Types ====================

export interface ScoutInput {
	readonly url: string;
	readonly task: string;
	readonly publish?: boolean | undefined;
}

export interface ScoutResult {
	readonly siteId: string;
	readonly endpointCount: number;
	readonly pathId: string;
	readonly openApiSpec: Record<string, unknown>;
	readonly fromGallery?: boolean | undefined;
}

// ==================== Helpers ====================

function generateId(prefix: string): string {
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `${prefix}_${ts}_${rand}`;
}

function nowISO(): string {
	return new Date().toISOString();
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

const VALID_METHODS = new Set<string>(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

function isValidMethod(m: string): m is HttpMethod {
	return VALID_METHODS.has(m.toUpperCase());
}

/** Group network events by normalized endpoint pattern */
function groupByEndpoint(
	events: ReadonlyArray<NetworkEvent>,
): Map<string, { method: HttpMethod; pattern: string; events: NetworkEvent[] }> {
	const groups = new Map<string, { method: HttpMethod; pattern: string; events: NetworkEvent[] }>();

	for (const ev of events) {
		if (!isApiRequest(ev.resourceType, ev.url)) continue;

		const method = ev.method.toUpperCase();
		if (!isValidMethod(method)) continue;

		let pattern: string;
		try {
			pattern = normalizeUrlPattern(ev.url);
		} catch {
			continue; // Skip malformed URLs
		}

		const key = `${method} ${pattern}`;
		const existing = groups.get(key);
		if (existing) {
			existing.events.push(ev);
		} else {
			groups.set(key, { method, pattern, events: [ev] });
		}
	}

	return groups;
}

/** Try to parse a response body as JSON */
function tryParseJson(body: string | undefined): unknown | undefined {
	if (!body) return undefined;
	try {
		return JSON.parse(body);
	} catch {
		return undefined;
	}
}

// ==================== Endpoint Building ====================

interface EndpointGroup {
	method: HttpMethod;
	pattern: string;
	events: NetworkEvent[];
}

function collectSamples(events: NetworkEvent[]): {
	responseSamples: unknown[];
	requestSamples: unknown[];
} {
	const responseSamples: unknown[] = [];
	const requestSamples: unknown[] = [];

	for (const ev of events) {
		const resBody = tryParseJson(ev.responseBody);
		if (resBody !== undefined) responseSamples.push(resBody);

		const reqBody = tryParseJson(ev.requestBody);
		if (reqBody !== undefined) requestSamples.push(reqBody);
	}

	return { responseSamples, requestSamples };
}

const buildEndpoint = (
	group: EndpointGroup,
	siteId: string,
	now: string,
): Effect.Effect<CapturedEndpoint, never, SchemaInferrer> =>
	Effect.gen(function* () {
		const inferrer = yield* SchemaInferrer;
		const epId = generateId("ep");
		const { responseSamples, requestSamples } = collectSamples(group.events);

		const responseSchema =
			responseSamples.length > 0 ? yield* inferrer.infer(responseSamples) : undefined;
		const requestSchema =
			requestSamples.length > 0 ? yield* inferrer.infer(requestSamples) : undefined;

		return new CapturedEndpoint({
			id: epId,
			siteId,
			method: group.method,
			pathPattern: group.pattern,
			requestSchema: requestSchema ? Option.some(requestSchema) : Option.none(),
			responseSchema: responseSchema ? Option.some(responseSchema) : Option.none(),
			sampleCount: group.events.length,
			firstSeenAt: now,
			lastSeenAt: now,
		});
	});

// ==================== Persistence ====================

const persistResults = (
	site: Site,
	endpoints: CapturedEndpoint[],
	path: ScoutedPath,
	openApiSpec: Record<string, unknown>,
	screenshot: Uint8Array,
	input: { url: string; task: string },
): Effect.Effect<void, StoreError, Store> =>
	Effect.gen(function* () {
		const store = yield* Store;

		yield* store.saveSite(site);

		if (endpoints.length > 0) {
			yield* store.saveEndpoints(endpoints);
		}

		yield* store.savePath(path);

		yield* store.saveBlob(`screenshots/${site.id}/scout.png`, screenshot);

		const specBytes = new TextEncoder().encode(JSON.stringify(openApiSpec, null, 2));
		yield* store.saveBlob(`specs/${site.id}/openapi.json`, specBytes);

		yield* store.saveRun({
			id: generateId("run"),
			pathId: path.id,
			tool: "scout",
			status: "success",
			input: JSON.stringify({ url: input.url, task: input.task }),
			output: JSON.stringify({
				siteId: site.id,
				endpointCount: endpoints.length,
				pathId: path.id,
			}),
			createdAt: site.lastScoutedAt,
		});
	});

// ==================== Scout Effect ====================

export const scout = (
	input: ScoutInput,
): Effect.Effect<
	ScoutResult,
	BrowserError | StoreError,
	Browser | Store | SchemaInferrer | OpenApiGenerator
> =>
	Effect.gen(function* () {
		const openapi = yield* OpenApiGenerator;
		const store = yield* Store;

		const now = nowISO();
		const domain = extractDomain(input.url);

		// Check gallery for cached spec (optional — skip if Gallery isn't in layer)
		const galleryResult = yield* Effect.serviceOption(Gallery).pipe(
			Effect.flatMap((galleryOpt) => {
				if (Option.isNone(galleryOpt)) return Effect.succeed(null);
				const gallery = galleryOpt.value;
				return gallery.getByDomain(domain).pipe(
					Effect.flatMap((entry) => {
						if (!entry) return Effect.succeed(null);
						return gallery.getSpec(entry.id).pipe(
							Effect.map((spec) => ({ entry, spec })),
							Effect.catchAll(() => Effect.succeed(null)),
						);
					}),
					Effect.catchAll(() => Effect.succeed(null)),
				);
			}),
		);

		if (galleryResult) {
			// Return cached spec from gallery
			const siteId = generateId("site");
			const site = new Site({
				id: siteId,
				url: input.url,
				domain,
				firstScoutedAt: now,
				lastScoutedAt: now,
			});

			// Extract endpoints from gallery spec so they're persisted for directory publish
			const specPaths =
				(galleryResult.spec as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
			const galleryEndpoints: CapturedEndpoint[] = [];
			for (const [pathPattern, methods] of Object.entries(specPaths)) {
				for (const [method, _detail] of Object.entries(methods)) {
					const upperMethod = method.toUpperCase();
					if (!isValidMethod(upperMethod)) continue;
					const epId = generateId("ep");
					galleryEndpoints.push(
						new CapturedEndpoint({
							id: epId,
							siteId,
							method: upperMethod as HttpMethod,
							pathPattern,
							requestSchema: Option.none(),
							responseSchema: Option.none(),
							sampleCount: 0,
							firstSeenAt: now,
							lastSeenAt: now,
						}),
					);
				}
			}

			const pathId = generateId("path");
			const path = new ScoutedPath({
				id: pathId,
				siteId,
				task: input.task,
				steps: [new PathStep({ action: "navigate", url: input.url })],
				endpointIds: galleryEndpoints.map((ep) => ep.id),
				status: "active",
				createdAt: now,
				lastUsedAt: Option.some(now),
				failCount: 0,
				healCount: 0,
			});

			yield* store.saveSite(site);
			if (galleryEndpoints.length > 0) {
				yield* store.saveEndpoints(galleryEndpoints);
			}
			yield* store.savePath(path);

			// Store the gallery spec so directory.publish can find it
			const specBytes = new TextEncoder().encode(JSON.stringify(galleryResult.spec, null, 2));
			yield* store.saveBlob(`specs/${siteId}/openapi.json`, specBytes);

			yield* store.saveRun({
				id: generateId("run"),
				pathId: path.id,
				tool: "scout",
				status: "success",
				input: JSON.stringify({ url: input.url, task: input.task }),
				output: JSON.stringify({
					siteId: site.id,
					endpointCount: galleryEndpoints.length,
					pathId: path.id,
					fromGallery: true,
				}),
				createdAt: now,
			});

			// Publish to gallery
			yield* Effect.serviceOption(Gallery).pipe(
				Effect.flatMap((galleryOpt) => {
					if (Option.isNone(galleryOpt)) return Effect.void;
					return galleryOpt.value.publish(siteId).pipe(Effect.catchAll(() => Effect.void));
				}),
			);

			// Publish to directory if explicitly requested
			if (input.publish === true) {
				yield* Effect.serviceOption(Directory).pipe(
					Effect.flatMap((dirOpt) => {
						if (Option.isNone(dirOpt)) return Effect.void;
						return dirOpt.value.publish(siteId).pipe(
							Effect.catchTag("ValidationError", (e) => {
								console.error(
									`[Scout] Directory publish validation failed: ${e.field} - ${e.message}`,
								);
								return Effect.fail(e);
							}),
							Effect.catchAll((e) => {
								console.error(`[Scout] Directory publish failed: ${e}`);
								return Effect.void;
							}),
						);
					}),
				);
			}

			return {
				siteId,
				endpointCount: galleryEndpoints.length,
				pathId,
				openApiSpec: galleryResult.spec,
				fromGallery: true,
			} satisfies ScoutResult;
		}

		// No cached spec, proceed with browser scouting
		const browser = yield* Browser;
		const siteId = generateId("site");

		// 1. Navigate and capture network traffic
		yield* browser.navigate(input.url);
		const events = yield* browser.getNetworkEvents();
		const screenshot = yield* browser.screenshot();

		// 2. Group events and build endpoints
		const grouped = groupByEndpoint(events);
		const endpoints = yield* Effect.forEach([...grouped.values()], (group) =>
			buildEndpoint(group, siteId, now),
		);

		// 3. Build domain objects
		const site = new Site({
			id: siteId,
			url: input.url,
			domain,
			firstScoutedAt: now,
			lastScoutedAt: now,
		});

		const pathId = generateId("path");
		const path = new ScoutedPath({
			id: pathId,
			siteId,
			task: input.task,
			steps: [new PathStep({ action: "navigate", url: input.url })],
			endpointIds: endpoints.map((ep) => ep.id),
			status: "active",
			createdAt: now,
			lastUsedAt: Option.some(now),
			failCount: 0,
			healCount: 0,
		});

		// 4. Generate OpenAPI spec
		const openApiSpec = yield* openapi.generate(input.url, endpoints);

		// 5. Persist everything
		yield* persistResults(site, [...endpoints], path, openApiSpec, screenshot, input);

		// 6. Publish to gallery if requested (and Gallery service is available)
		if (input.publish !== false) {
			yield* Effect.serviceOption(Gallery).pipe(
				Effect.flatMap((galleryOpt) => {
					if (Option.isNone(galleryOpt)) return Effect.void;
					return galleryOpt.value.publish(siteId).pipe(Effect.catchAll(() => Effect.void));
				}),
			);
		}

		// 7. Publish to directory if explicitly requested
		if (input.publish === true) {
			yield* Effect.serviceOption(Directory).pipe(
				Effect.flatMap((dirOpt) => {
					if (Option.isNone(dirOpt)) return Effect.void;
					return dirOpt.value.publish(siteId).pipe(
						Effect.catchTag("ValidationError", (e) => {
							console.error(
								`[Scout] Directory publish validation failed: ${e.field} - ${e.message}`,
							);
							return Effect.fail(e);
						}),
						Effect.catchAll((e) => {
							console.error(`[Scout] Directory publish failed: ${e}`);
							return Effect.void;
						}),
					);
				}),
			);
		}

		return { siteId, endpointCount: endpoints.length, pathId, openApiSpec } satisfies ScoutResult;
	});
