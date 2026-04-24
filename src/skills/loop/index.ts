/**
 * loop skill — public entry point.
 *
 * ```ts
 * import { loop } from "unsurf/skills/loop";
 *
 * const result = await loop({
 *   spec: "Go to httpbin, fill the form with my name and email",
 *   northStar: "Did the user fill all three text fields with non-empty values?",
 *   maxIterations: 3,
 * });
 *
 * console.log(result.met, result.iterations.map(t => t.traceUrl));
 * ```
 *
 * Composes on top of the `record` and `observe-video` skills — swapping
 * either of their providers bubbles up to loop for free.
 */

export { kimiPlanner, kimiRefiner, kimiYesNo, localRecordFn } from "./backends.js";
export { runSpec, validateSpec } from "./interpret.js";
export { loop } from "./loop.js";
export type {
	LoopOptions,
	LoopResult,
	LoopSpec,
	LoopStep,
	LoopTick,
	ObserveFn,
	Planner,
	RecordFn,
	Refiner,
} from "./types.js";
