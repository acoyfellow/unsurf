/**
 * loop skill — type surface.
 *
 * Closes the record → observe cycle: an agent hands in a goal, loop()
 * records a browser session, observes the video, and if the North Star
 * isn't met, asks a refiner LLM to rewrite the spec and tries again.
 * Stops on success, on max iterations, or on repeated failure to refine.
 *
 * Deliberately *not* a provider — composes on top of the record and
 * observe-video skills via their public APIs. A caller swapping record
 * providers (local → browser-run) gets it for free.
 */

import type { BrowserHandle } from "../record/types.js";

// ==================== Spec ====================

/**
 * One browser action. Maps 1:1 to BrowserHandle methods so the refiner
 * LLM can emit a pure-data plan without us needing a sandbox.
 *
 * Only data in, no code. The loop interpreter walks this array and calls
 * the matching BrowserHandle method.
 */
export type LoopStep =
	| { op: "goto"; url: string }
	| { op: "fill"; selector: string; value: string }
	| { op: "click"; selector: string }
	| { op: "wait"; ms: number }
	| { op: "waitFor"; selector: string; timeoutMs?: number }
	| { op: "snapshot" };

export interface LoopSpec {
	/** Optional starting URL. If set, implies a `goto` before `steps` runs. */
	url?: string;
	/** Ordered list of browser actions. */
	steps: LoopStep[];
	/** Free-form note the refiner can annotate itself with between iterations. */
	notes?: string;
}

// ==================== Options ====================

export interface LoopOptions {
	/**
	 * Either a concrete starting spec OR a natural-language goal the
	 * refiner will synthesize into a first spec.
	 *
	 * Examples:
	 *   { url: "https://httpbin.org/forms/post", steps: [{op:"fill",selector:"input[name=custname]",value:"Jordan"}] }
	 *   "Go to coey.dev, click Projects, scroll, open the project that mentions observability"
	 */
	spec: LoopSpec | string;

	/**
	 * The condition observeVideo will check after each recording. Should
	 * be phrased as a yes/no question so the `met` signal is unambiguous.
	 *
	 * Example: "Did the user end up on an authenticated dashboard page?"
	 */
	northStar: string;

	/**
	 * How the LLM decides whether a recording meets the North Star. The
	 * synthesis backend returns { answer, confidence }; we treat
	 * confidence >= met.minConfidence AND the answer matching
	 * met.pattern (or a heuristic yes/no parse) as "met".
	 */
	met?: {
		/** Default 0.7. */
		minConfidence?: number;
		/**
		 * Regex the answer must match. Default: /\b(yes|succeeded|successful|completed|reached|achieved)\b/i.
		 */
		pattern?: RegExp;
	};

	/** Max iterations before giving up. Default 5. */
	maxIterations?: number;

	/**
	 * Hard wall-clock budget per iteration. If a single tick exceeds this
	 * the loop aborts that iteration with an error and either refines or
	 * gives up. Default 120000 (2 minutes).
	 */
	tickMs?: number;

	/**
	 * Called once per iteration with the latest observation. Useful for
	 * streaming progress into a TUI or CI log.
	 */
	onTick?: (tick: LoopTick) => void;

	// ==================== Injectables (all have Workers AI defaults) ====================

	/**
	 * Rewrites the spec based on the last observation. Default uses Kimi
	 * K2.6 via Workers AI.
	 */
	refiner?: Refiner;

	/**
	 * Synthesizes the first spec from a natural-language goal. Required
	 * only when `spec` is a string. Default uses Kimi K2.6 via Workers AI.
	 */
	planner?: Planner;

	/**
	 * How to record each iteration. Default shells out to agent-browser
	 * via the record skill and uploads to trace.coey.dev.
	 *
	 * Callers who want a different provider (e.g. cloud) swap this.
	 */
	recordFn?: RecordFn;

	/** How to observe each video. Default = observeVideo() from observe-video skill. */
	observeFn?: ObserveFn;
}

// ==================== Outputs ====================

export interface LoopTick {
	iteration: number; // 0-based
	spec: LoopSpec;
	traceUrl?: string;
	videoUrl?: string;
	answer?: string;
	confidence?: number;
	met: boolean;
	error?: string;
	durationMs: number;
}

export interface LoopResult {
	met: boolean;
	iterations: LoopTick[];
	/** The last answer from observeVideo, whether or not the North Star was met. */
	finalAnswer?: string;
	/** Reason the loop stopped: "met" | "maxIterations" | "errorBudget" | "abort". */
	stopReason: "met" | "maxIterations" | "errorBudget" | "abort";
}

// ==================== Injectable interfaces ====================

export interface Refiner {
	/**
	 * Propose a better spec given the previous attempt's result. Return
	 * `null` to signal "I can't do better; give up."
	 */
	refine(input: {
		northStar: string;
		previousSpec: LoopSpec;
		previousAnswer: string;
		previousConfidence: number;
		iteration: number;
	}): Promise<LoopSpec | null>;
}

export interface Planner {
	/** Turn a natural-language goal into an executable spec. */
	plan(input: { goal: string; northStar: string }): Promise<LoopSpec>;
}

export type RecordFn = (input: {
	task: string;
	run: (browser: BrowserHandle) => Promise<void>;
}) => Promise<{ traceUrl: string; videoUrl?: string; videoPath?: string }>;

export type ObserveFn = (input: {
	video: string;
	question: string;
}) => Promise<{ answer: string; confidence: number }>;
