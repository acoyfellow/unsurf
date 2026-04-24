/**
 * loop() — the orchestrator.
 *
 *   spec ──▶ record ──▶ webm
 *                │
 *                ▼
 *       observeVideo(webm, northStar)
 *                │
 *      met ─yes─▶│ return LoopResult
 *                │
 *               no
 *                ▼
 *        refine(spec, obs, northStar) ─▶ next iteration
 *
 * Hard tick budget prevents silent hangs. If a tick exceeds tickMs,
 * that iteration is marked errored and the loop moves on (refine or
 * give up). Three consecutive errors → stop with "errorBudget".
 */

import { defaultObserveFn, kimiPlanner, kimiRefiner, localRecordFn } from "./backends.js";
import { runSpec as runSpecInBrowser } from "./interpret.js";
import type { LoopOptions, LoopResult, LoopSpec, LoopTick } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_TICK_MS = 120_000;
const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_MET_PATTERN = /\b(yes|succeeded|successful|completed|reached|achieved|confirmed)\b/i;
const ERROR_BUDGET = 3;

/** Build the exactOptional-safe version of { finalAnswer? }. */
function withFinalAnswer(v: string | undefined): { finalAnswer?: string } {
	return v === undefined ? {} : { finalAnswer: v };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms budget`)), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

function didMeet(
	answer: string,
	confidence: number,
	minConfidence: number,
	pattern: RegExp,
): boolean {
	if (confidence < minConfidence) return false;
	if (pattern.test(answer)) return true;
	// Heuristic: if confidence is high AND answer doesn't start with "no"/"not",
	// treat as met. Kimi tends to phrase successes declaratively rather than
	// literally saying "yes".
	const trimmed = answer.trim().toLowerCase();
	if (confidence >= 0.9 && !trimmed.startsWith("no") && !trimmed.startsWith("not")) {
		return true;
	}
	return false;
}

export async function loop(opts: LoopOptions): Promise<LoopResult> {
	const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
	const minConfidence = opts.met?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
	const metPattern = opts.met?.pattern ?? DEFAULT_MET_PATTERN;
	const planner = opts.planner ?? kimiPlanner();
	const refiner = opts.refiner ?? kimiRefiner();
	const recordFn = opts.recordFn ?? localRecordFn();
	const observeFn = opts.observeFn ?? defaultObserveFn();

	// Materialize the initial spec.
	let currentSpec: LoopSpec;
	if (typeof opts.spec === "string") {
		currentSpec = await planner.plan({ goal: opts.spec, northStar: opts.northStar });
	} else {
		currentSpec = opts.spec;
	}

	const iterations: LoopTick[] = [];
	let consecutiveErrors = 0;

	for (let i = 0; i < maxIterations; i++) {
		const startedAt = Date.now();
		const tick: LoopTick = {
			iteration: i,
			spec: currentSpec,
			met: false,
			durationMs: 0,
		};

		try {
			// Record the run. The callback walks the current spec.
			const capturedSpec = currentSpec;
			const recorded = await withTimeout(
				recordFn({
					task: `loop iteration ${i}: ${opts.northStar.slice(0, 80)}`,
					run: (browser) => runSpecInBrowser(capturedSpec, browser),
				}),
				tickMs,
				`iteration ${i} record`,
			);
			tick.traceUrl = recorded.traceUrl;
			if (recorded.videoUrl) tick.videoUrl = recorded.videoUrl;

			if (!recorded.videoUrl && !recorded.videoPath) {
				throw new Error("record did not return a video URL or path");
			}
			const videoRef = (recorded.videoPath || recorded.videoUrl) as string;

			// Observe.
			const observation = await withTimeout(
				observeFn({ video: videoRef, question: opts.northStar }),
				tickMs,
				`iteration ${i} observe`,
			);
			tick.answer = observation.answer;
			tick.confidence = observation.confidence;
			tick.met = didMeet(observation.answer, observation.confidence, minConfidence, metPattern);

			consecutiveErrors = 0;
		} catch (e) {
			tick.error = (e as Error).message;
			consecutiveErrors++;
		} finally {
			tick.durationMs = Date.now() - startedAt;
			iterations.push(tick);
			opts.onTick?.(tick);
		}

		if (tick.met) {
			return {
				met: true,
				iterations,
				stopReason: "met",
				...withFinalAnswer(tick.answer),
			};
		}

		if (consecutiveErrors >= ERROR_BUDGET) {
			return {
				met: false,
				iterations,
				stopReason: "errorBudget",
				...withFinalAnswer(tick.answer),
			};
		}

		// Not met and not at budget — ask for a refined spec for the next turn.
		// Skip the refine on the last iteration since we'd never use its output.
		if (i === maxIterations - 1) break;
		try {
			const refined = await withTimeout(
				refiner.refine({
					northStar: opts.northStar,
					previousSpec: currentSpec,
					previousAnswer: tick.answer ?? tick.error ?? "(no observation)",
					previousConfidence: tick.confidence ?? 0,
					iteration: i,
				}),
				tickMs,
				`iteration ${i} refine`,
			);
			if (!refined) {
				return {
					met: false,
					iterations,
					stopReason: "abort",
					...withFinalAnswer(tick.answer),
				};
			}
			currentSpec = refined;
		} catch (e) {
			// Treat refiner failure like any other tick error — counts
			// against the budget but doesn't immediately abort.
			consecutiveErrors++;
			iterations.push({
				iteration: i + 0.5,
				spec: currentSpec,
				met: false,
				error: `refine failed: ${(e as Error).message}`,
				durationMs: 0,
			});
			if (consecutiveErrors >= ERROR_BUDGET) {
				return {
					met: false,
					iterations,
					stopReason: "errorBudget",
					...withFinalAnswer(tick.answer),
				};
			}
		}
	}

	return {
		met: false,
		iterations,
		stopReason: "maxIterations",
		...withFinalAnswer(iterations[iterations.length - 1]?.answer),
	};
}
