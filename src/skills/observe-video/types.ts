/**
 * observe-video skill — type surface.
 *
 * Takes a recorded browser session (webm/mp4) and answers a question about
 * what the video shows, using a vision model to caption keyframes and a
 * text model to synthesize the final answer.
 *
 * Designed to close the loop started by the `record` skill: agents can
 * watch their own runs and decide what to change next.
 */

export interface ObserveOptions {
	/**
	 * Video to observe. Either:
	 *   - local file path ("./tour.webm")
	 *   - http(s) URL (will be downloaded to a tmp file)
	 */
	video: string;

	/**
	 * What you want to know. Free-form natural language.
	 * Examples:
	 *   "Did the user submit the form?"
	 *   "What page did the user end up on?"
	 *   "Did the login flow succeed?"
	 */
	question: string;

	/**
	 * Max frames to extract. The pipeline picks scene-change frames first,
	 * then falls back to evenly-spaced sampling. Default 8.
	 */
	maxFrames?: number;

	/**
	 * Scene-change sensitivity for ffmpeg (0..1). Lower = more frames.
	 * Default 0.3 — roughly "a human would say this is a new scene".
	 */
	sceneThreshold?: number;

	/** Vision backend (caption each frame). Default = Workers AI Llama vision. */
	visionBackend?: VisionBackend;

	/** Synthesis backend (combine captions + question into final answer). Default = Workers AI Kimi K2. */
	synthesisBackend?: SynthesisBackend;

	/**
	 * Optional: keep extracted frames on disk. Default false (cleans up).
	 * Path is returned in `evidenceFrames[].path` regardless; it just gets
	 * deleted at the end unless this is true.
	 */
	keepFrames?: boolean;
}

export interface FrameEvidence {
	/** 0-based index among extracted frames. */
	index: number;
	/** Millisecond timestamp in the video. */
	t: number;
	/** Absolute path on disk. Valid only if `keepFrames: true` or during the call. */
	path: string;
	/** Caption produced by the vision backend. */
	caption: string;
}

export interface ObserveResult {
	/** Final natural-language answer to `question`. */
	answer: string;
	/** Self-reported confidence (0..1). May be a model estimate; treat as advisory. */
	confidence: number;
	/** Extracted frames and their captions, in video order. */
	evidenceFrames: FrameEvidence[];
	/** Opaque backend-specific raw response, for debugging. Do not rely on its shape. */
	raw?: {
		vision?: unknown;
		synthesis?: unknown;
	};
}

// ==================== Backends ====================

export interface VisionBackend {
	/**
	 * Caption one frame. Return a short (~1-2 sentence) description of what
	 * is happening in the frame, written in past-tense active voice so
	 * captions read naturally when joined into a narrative.
	 *
	 * Example output: "The user typed 'Jordan' into the Customer name field."
	 */
	caption(frame: { index: number; t: number; png: Uint8Array }): Promise<string>;
}

export interface SynthesisBackend {
	/**
	 * Combine per-frame captions + the user's question into a final answer.
	 *
	 * MUST return structured JSON: `{ answer: string, confidence: number }`.
	 * The backend is responsible for parsing its own model output; the skill
	 * treats the return value as authoritative.
	 */
	synthesize(input: {
		question: string;
		captions: { t: number; caption: string }[];
	}): Promise<{ answer: string; confidence: number; raw?: unknown }>;
}
