/**
 * trace skill — type surface.
 *
 * A skill that wraps any agent browser run and returns a canonical URL pointing
 * to a video recording, a step trace, and a result bundle.
 *
 * No runtime dependencies. Pure types. Runtime lives in index.ts (Phase 1).
 *
 * See ./SPEC.md for the bundle format and URL shape.
 * See ./SECURITY.md for the two-Worker split and signing scheme.
 */

import type { EvidenceBundle } from "@acoyfellow/proof-spec";

// ==================== Browser handle ====================

/**
 * The minimum surface a browser provider must expose to the record skill.
 *
 * Providers wrap their underlying driver (agent-browser, puppeteer, playwright,
 * filepath sandbox RPC) behind this interface. The skill never talks to the
 * driver directly — it only talks to a `BrowserHandle`.
 *
 * Every method is awaitable. Errors propagate as rejections; the recorder
 * uploads a partial bundle marked `status: "failed"`.
 */
export interface BrowserHandle {
	/** Navigate and wait for load. */
	goto(url: string): Promise<void>;
	/** Click an element by CSS selector. */
	click(selector: string): Promise<void>;
	/** Clear and type into an input-like element. */
	fill(selector: string, value: string): Promise<void>;
	/** Wait either for a duration (ms) or for a selector to appear. */
	wait(arg: number | { selector: string; timeoutMs?: number }): Promise<void>;
	/** Accessibility-tree or DOM snapshot. Shape is opaque to the skill. */
	snapshot(): Promise<unknown>;
	/** Screenshot as PNG bytes. */
	screenshot(): Promise<Uint8Array>;

	/**
	 * Start recording. Provider is responsible for producing a WebM at the
	 * returned path when `stopRecording` resolves. Path is an absolute local
	 * path on whichever machine the provider runs on (sandbox, container,
	 * caller's box).
	 */
	startRecording(path: string): Promise<void>;
	/** Stop recording. Resolves when the file at `path` is flushed. */
	stopRecording(): Promise<void>;

	/** Release resources. Idempotent. */
	close(): Promise<void>;
}

// ==================== Step trace ====================

/**
 * One entry in trace.json. Captures the intent of a browser call with a
 * monotonic timestamp. Arguments are captured; return values are not (to keep
 * the trace small — see video for the full picture).
 */
export interface TraceStep {
	/** Monotonic ms since trace start. */
	t: number;
	/** Matches a method name on BrowserHandle. */
	op: "goto" | "click" | "fill" | "wait" | "snapshot" | "screenshot";
	/** Flattened call arguments. Strings inlined; objects JSON-encoded. */
	args: Record<string, string | number | boolean>;
	/** "ok" if resolved, "err" if threw. */
	status: "ok" | "err";
	/** Human-readable error message if `status === "err"`. */
	error?: string;
	/** Duration of the call itself, in ms. */
	durationMs: number;
}

// ==================== Record options ====================

export interface RecordOptions {
	/** Task label. Appears in meta.json and the viewer UI. */
	task: string;
	/**
	 * The browser provider. If omitted, the skill picks a default based on
	 * runtime: `local` in Node (agent-browser on PATH), `browserRendering` in
	 * a Worker (Cloudflare BR binding).
	 */
	browser?: BrowserHandle;
	/**
	 * Caller's code. Receives the handle, runs whatever it wants. The skill
	 * wraps every call to add it to trace.json.
	 */
	run: (browser: BrowserHandle) => Promise<unknown>;
	/**
	 * Upload destination. Defaults to the skill's configured ingest endpoint
	 * (see SECURITY.md). Callers inside the filepath sandbox pass a direct R2
	 * service binding instead.
	 */
	uploader?: Uploader;
	/**
	 * Optional free-form metadata merged into meta.json. Useful for linking
	 * back to the caller's system (runId, workspaceId, conversationId).
	 */
	meta?: Record<string, string | number | boolean>;
}

// ==================== Uploader ====================

/**
 * Contract for uploading a bundle. The core skill knows nothing about R2 or
 * Workers. It hands a manifest + bytes to the uploader and trusts the returned
 * canonical URL.
 */
export interface Uploader {
	upload(bundle: Bundle): Promise<UploadResult>;
}

export interface Bundle {
	id: string;
	video?: Uint8Array;
	trace: TraceJson;
	result: ResultJson;
	meta: MetaJson;
}

export interface UploadResult {
	/** Canonical viewer URL, e.g. `https://unsurf.coey.dev/r/abc123`. */
	url: string;
	/** Signed video URL. May be undefined if there was no video. */
	videoUrl?: string;
	/** Receipt URL returning `ResultJson`. */
	resultUrl: string;
}

// ==================== Bundle JSON shapes ====================

export interface TraceJson {
	version: "v0";
	id: string;
	startedAt: string;
	finishedAt: string;
	steps: readonly TraceStep[];
}

/**
 * Compatible with the lab result shape and embeds a `ProofSpec`-style
 * evidence bundle so gateproof assertions can attach.
 */
export interface ResultJson {
	version: "v0";
	id: string;
	status: "succeeded" | "failed";
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	task: string;
	error?: string;
	/** Optional proof-spec evidence if the run was a proof execution. */
	evidence?: EvidenceBundle;
}

export interface MetaJson {
	version: "v0";
	id: string;
	task: string;
	provider: "local" | "filepath" | "browserRendering" | "custom";
	harness?: string;
	extra?: Record<string, string | number | boolean>;
}

// ==================== Skill return ====================

/** What `record()` resolves to. */
export interface RecordResult extends UploadResult {
	id: string;
	status: "succeeded" | "failed";
	durationMs: number;
	/** The value the `run` callback returned, if it resolved. */
	returned?: unknown;
	error?: string;
}
