/**
 * `record(opts)` — the core skill.
 *
 * Runs a user callback against a BrowserHandle, records the whole thing as
 * WebM, captures a step trace, bundles it with a result and meta, and uploads
 * via the supplied Uploader. Returns a canonical trace URL.
 *
 * Failure semantics:
 *   - callback throws     → partial bundle uploaded, status: "failed"
 *   - upload fails        → error propagates; local bundle path is stashed
 *                           on the thrown Error as `err.localPath` so the
 *                           caller can retry
 *   - recording fails     → logged, run continues, bundle has no video
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { newTraceId } from "./id.js";
import { traceHandle } from "./tracer.js";
import type {
	BrowserHandle,
	Bundle,
	MetaJson,
	RecordOptions,
	RecordResult,
	ResultJson,
	TraceJson,
	Uploader,
} from "./types.js";

export interface RecordRuntimeDeps {
	/** Factory that returns a BrowserHandle. Caller (provider) owns lifecycle. */
	openBrowser: () => Promise<BrowserHandle>;
	/** Required: where bundles go. */
	uploader: Uploader;
	/** Provider tag written into meta.json. */
	provider: MetaJson["provider"];
	/** Optional harness name (pi, opencode, filepath, …) written into meta. */
	harness?: string;
}

/**
 * Shape callers pass. `browser` and `uploader` in RecordOptions are optional
 * escape hatches; runtime deps override them.
 */
export async function record(opts: RecordOptions, deps: RecordRuntimeDeps): Promise<RecordResult> {
	const id = newTraceId();
	const startedAt = new Date();
	const videoDir = path.join(tmpdir(), `unsurf-trace-${id}`);
	await mkdir(videoDir, { recursive: true });
	const videoPath = path.join(videoDir, `${id}.webm`);

	let browser: BrowserHandle | null = null;
	let recordingStarted = false;
	let returned: unknown;
	let runError: Error | null = null;

	const tracer = (() => {
		// Initialised below once browser is open.
		return {
			steps: [] as ReturnType<typeof traceHandle>["steps"],
			handle: null as BrowserHandle | null,
		};
	})();

	try {
		browser = await deps.openBrowser();
		const traced = traceHandle(browser);
		tracer.steps = traced.steps;
		tracer.handle = traced.handle;

		if (browser.capabilities?.recording !== false) {
			try {
				await browser.startRecording(videoPath);
				recordingStarted = true;
			} catch (e) {
				console.warn(`[trace ${id}] startRecording failed: ${(e as Error).message}`);
			}
		}

		try {
			returned = await opts.run(traced.handle);
		} catch (e) {
			runError = e instanceof Error ? e : new Error(String(e));
		}

		if (recordingStarted) {
			try {
				await browser.stopRecording();
			} catch (e) {
				console.warn(`[trace ${id}] stopRecording failed: ${(e as Error).message}`);
			}
		}
	} finally {
		if (browser) {
			try {
				await browser.close();
			} catch {
				/* ignore */
			}
		}
	}

	const finishedAt = new Date();
	const durationMs = finishedAt.getTime() - startedAt.getTime();
	const status: "succeeded" | "failed" = runError ? "failed" : "succeeded";

	const trace: TraceJson = {
		version: "v0",
		id,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		steps: tracer.steps,
	};

	const result: ResultJson = {
		version: "v0",
		id,
		status,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs,
		task: opts.task,
		...(runError ? { error: runError.message.slice(0, 500) } : {}),
	};

	const meta: MetaJson = {
		version: "v0",
		id,
		task: opts.task,
		provider: deps.provider,
		...(deps.harness ? { harness: deps.harness } : {}),
		...(opts.meta ? { extra: opts.meta } : {}),
		...(opts.visibility ? { visibility: opts.visibility } : {}),
	};

	let video: Uint8Array | undefined;
	if (recordingStarted) {
		try {
			const buf = await readFile(videoPath);
			video = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		} catch (e) {
			console.warn(`[trace ${id}] could not read video: ${(e as Error).message}`);
		}
	}

	const bundle: Bundle = { id, trace, result, meta, ...(video ? { video } : {}) };

	let uploaded: import("./types.js").UploadResult;
	try {
		uploaded = await deps.uploader.upload(bundle);
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		(err as Error & { localPath?: string }).localPath = videoDir;
		throw err;
	}

	// Clean up local temp video now that the bundle is safely uploaded.
	await rm(videoDir, { recursive: true, force: true }).catch(() => {});

	return {
		...uploaded,
		id,
		status,
		durationMs,
		...(runError ? { error: runError.message } : {}),
		...(returned !== undefined ? { returned } : {}),
	};
}
