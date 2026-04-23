/**
 * observe-video skill — public entry point.
 *
 * ```ts
 * import { observeVideo } from "unsurf/skills/observe-video";
 *
 * const { answer, confidence, evidenceFrames } = await observeVideo({
 *   video: "./tour.webm",
 *   question: "Did the user submit the form?",
 * });
 * ```
 *
 * See ./types.ts for the full API and ./backends/workers-ai.ts for the
 * default Workers AI vision + Kimi K2 synthesis backends.
 */

export {
	type WorkersAiCreds,
	type WorkersAiSynthesisOptions,
	type WorkersAiVisionOptions,
	workersAiSynthesisBackend,
	workersAiVisionBackend,
} from "./backends/workers-ai.js";
export { cleanupFramesDir, extractFrames, probeDurationMs } from "./frames.js";
export { observeVideo } from "./observe.js";
export type {
	FrameEvidence,
	ObserveOptions,
	ObserveResult,
	SynthesisBackend,
	VisionBackend,
} from "./types.js";
