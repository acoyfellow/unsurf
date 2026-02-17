import { Effect, Option, Schedule } from "effect";
import type {
	BlockedDomainError,
	BrowserError,
	NotFoundError,
	StoreError,
} from "../domain/Errors.js";
import type { Browser } from "../services/Browser.js";
import type { OpenApiGenerator } from "../services/OpenApiGenerator.js";
import type { SchemaInferrer } from "../services/SchemaInferrer.js";
import { Store } from "../services/Store.js";
import { scout } from "./Scout.js";
import { worker } from "./Worker.js";

// ==================== Types ====================

export interface HealInput {
	readonly pathId: string;
	readonly error?: string | undefined;
}

export interface HealResult {
	readonly healed: boolean;
	readonly newPathId?: string | undefined;
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

// ==================== Retry Policy ====================

const retryPolicy = Schedule.intersect(Schedule.recurs(2), Schedule.exponential("500 millis"));

// ==================== Mark Path Broken ====================

const markBroken = (
	pathId: string,
	error: string | undefined,
): Effect.Effect<void, NotFoundError | StoreError, Store> =>
	Effect.gen(function* () {
		const store = yield* Store;
		const path = yield* store.getPath(pathId);

		const updated = {
			...path,
			status: "broken" as const,
			failCount: path.failCount + 1,
		};
		yield* store.savePath(updated);

		yield* store.saveRun({
			id: generateId("run"),
			pathId,
			tool: "heal",
			status: "failure",
			input: JSON.stringify({ pathId, error }),
			error: error ?? "Unknown error",
			createdAt: nowISO(),
		});
	});

// ==================== Re-scout and Retry ====================

const rescoutAndRetry = (
	pathId: string,
): Effect.Effect<
	HealResult,
	BlockedDomainError | BrowserError | StoreError | NotFoundError,
	Browser | Store | SchemaInferrer | OpenApiGenerator
> =>
	Effect.gen(function* () {
		const store = yield* Store;
		const oldPath = yield* store.getPath(pathId);

		// Mark as healing
		yield* store.savePath({ ...oldPath, status: "healing" as const });

		// Load the site to get the URL
		const site = yield* store.getSite(oldPath.siteId);

		// Re-scout the same URL + task
		const scoutResult = yield* scout({ url: site.url, task: oldPath.task });

		// Try the worker with the new path
		const workerResult = yield* Effect.either(worker({ pathId: scoutResult.pathId }));

		if (workerResult._tag === "Right" && workerResult.right.success) {
			// Heal succeeded — update old path status
			yield* store.savePath({
				...oldPath,
				status: "active" as const,
				healCount: oldPath.healCount + 1,
			});

			yield* store.saveRun({
				id: generateId("run"),
				pathId,
				tool: "heal",
				status: "success",
				input: JSON.stringify({ pathId }),
				output: JSON.stringify({ newPathId: scoutResult.pathId }),
				createdAt: nowISO(),
			});

			return { healed: true, newPathId: scoutResult.pathId };
		}

		// Re-scout worked but worker still fails
		yield* store.savePath({
			...oldPath,
			status: "broken" as const,
			failCount: oldPath.failCount + 1,
			healCount: oldPath.healCount + 1,
		});

		return { healed: false };
	});

// ==================== Heal Effect ====================

export const heal = (
	input: HealInput,
): Effect.Effect<
	HealResult,
	BlockedDomainError | BrowserError | StoreError | NotFoundError,
	Browser | Store | SchemaInferrer | OpenApiGenerator
> =>
	Effect.gen(function* () {
		// 1. Try the worker first with retries (maybe it's a transient failure)
		const retryResult = yield* Effect.either(
			worker({ pathId: input.pathId }).pipe(Effect.retry(retryPolicy)),
		);

		if (retryResult._tag === "Right" && retryResult.right.success) {
			return { healed: true };
		}

		// 2. Retries exhausted — mark broken and re-scout
		yield* markBroken(input.pathId, input.error);

		// 3. Re-scout and retry with new path
		return yield* rescoutAndRetry(input.pathId);
	});
