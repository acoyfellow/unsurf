import { Effect, Option } from "effect";
import type { CapturedEndpoint } from "../domain/Endpoint.js";
import { NetworkError, type NotFoundError, type StoreError } from "../domain/Errors.js";
import { Store } from "../services/Store.js";

// ==================== Types ====================

export interface WorkerInput {
	readonly pathId: string;
	readonly data?: Record<string, unknown> | undefined;
	readonly headers?: Record<string, string> | undefined;
}

export interface WorkerResult {
	readonly success: boolean;
	readonly response?: unknown;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

// ==================== Helpers ====================

function generateId(prefix: string): string {
	const rand = Math.random().toString(36).slice(2, 10);
	const ts = Date.now().toString(36);
	return `${prefix}_${ts}_${rand}`;
}

function nowISO(): string {
	return new Date().toISOString();
}

/** Substitute path params like :id with values from data */
function resolveUrl(pattern: string, data: Record<string, unknown> | undefined): string {
	if (!data) return pattern;
	return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
		const val = data[name];
		return val !== undefined ? String(val) : `:${name}`;
	});
}

// ==================== HTTP Replay ====================

const replayEndpoint = (
	endpoint: CapturedEndpoint,
	data: Record<string, unknown> | undefined,
	customHeaders: Record<string, string> | undefined,
): Effect.Effect<unknown, NetworkError> =>
	Effect.gen(function* () {
		const url = resolveUrl(endpoint.pathPattern, data);
		const method = endpoint.method as HttpMethod;

		const hasBody = ["POST", "PUT", "PATCH"].includes(method);
		const headers: Record<string, string> = {
			Accept: "application/json",
			...customHeaders, // Merge custom headers (auth, cookies, etc.)
		};

		const init: RequestInit = { method, headers };
		if (hasBody && data) {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(data);
		}

		const response = yield* Effect.tryPromise({
			try: () => fetch(url, init),
			catch: (e) => new NetworkError({ url, message: `Fetch failed: ${e}` }),
		});

		if (!response.ok) {
			yield* Effect.fail(
				new NetworkError({
					url,
					status: response.status,
					message: `HTTP ${response.status} ${response.statusText}`,
				}),
			);
		}

		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("json")) {
			return yield* Effect.tryPromise({
				try: () => response.json(),
				catch: (e) => new NetworkError({ url, message: `JSON parse failed: ${e}` }),
			});
		}

		return yield* Effect.tryPromise({
			try: () => response.text(),
			catch: (e) => new NetworkError({ url, message: `Body read failed: ${e}` }),
		});
	});

// ==================== Persistence ====================

const saveWorkerRun = (
	pathId: string,
	success: boolean,
	data: Record<string, unknown> | undefined,
	response: unknown,
	error?: string | undefined,
): Effect.Effect<void, StoreError, Store> =>
	Effect.gen(function* () {
		const store = yield* Store;
		yield* store.saveRun({
			id: generateId("run"),
			pathId,
			tool: "worker",
			status: success ? "success" : "failure",
			input: JSON.stringify({ pathId, data }),
			output: success ? JSON.stringify(response) : undefined,
			error,
			createdAt: nowISO(),
		});
	});

// ==================== Worker Effect ====================

export const worker = (
	input: WorkerInput,
): Effect.Effect<WorkerResult, NotFoundError | NetworkError | StoreError, Store> =>
	Effect.gen(function* () {
		const store = yield* Store;

		// 1. Load the path
		const path = yield* store.getPath(input.pathId);

		// 2. Load endpoints for this path
		const allEndpoints = yield* store.getEndpoints(path.siteId);
		const pathEndpoints = allEndpoints.filter((ep) => path.endpointIds.includes(ep.id));

		if (pathEndpoints.length === 0) {
			yield* saveWorkerRun(input.pathId, false, input.data, null, "No endpoints found for path");
			return { success: false, response: "No endpoints found for path" };
		}

		// 3. Find the best endpoint to replay
		// Prefer POST/PUT/PATCH if data is provided, otherwise use the first GET
		const endpoint = input.data
			? (pathEndpoints.find((ep) => ["POST", "PUT", "PATCH"].includes(ep.method)) ??
				pathEndpoints[0])
			: (pathEndpoints.find((ep) => ep.method === "GET") ?? pathEndpoints[0]);

		if (!endpoint) {
			yield* saveWorkerRun(input.pathId, false, input.data, null, "No matching endpoint");
			return { success: false, response: "No matching endpoint" };
		}

		// 4. Replay the endpoint
		const response = yield* replayEndpoint(endpoint, input.data, input.headers);

		// 5. Save run history
		yield* saveWorkerRun(input.pathId, true, input.data, response);

		return { success: true, response };
	});
