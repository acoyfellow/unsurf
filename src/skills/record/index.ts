/**
 * trace skill — public entry point.
 *
 * Phase 1+3: `record()` runtime + local provider shipped. Phase 4 (filepath)
 * and Phase 5 (Browser Rendering) plug in as additional providers.
 *
 * See ./SPEC.md for the bundle shape.
 * See ./SECURITY.md for the deploy posture.
 */

import { type LocalProviderOptions, openLocalBrowser } from "./providers/local.js";
import { record as _record, type RecordRuntimeDeps } from "./record.js";
import type { RecordOptions, RecordResult } from "./types.js";
import { makeHttpUploader } from "./uploader.js";

export { newTraceId } from "./id.js";
export { type LocalProviderOptions, openLocalBrowser } from "./providers/local.js";
export { type RecordRuntimeDeps, record } from "./record.js";
export { traceHandle } from "./tracer.js";
export type {
	BrowserHandle,
	Bundle,
	MetaJson,
	RecordOptions,
	RecordResult,
	ResultJson,
	TraceJson,
	TraceStep,
	Uploader,
	UploadResult,
} from "./types.js";
export { type HttpUploaderOptions, makeHttpUploader } from "./uploader.js";

/** Frozen id regex. Any producer that emits a non-matching id is in error. */
export const TRACE_ID_REGEX = /^[0-9a-z]{12}$/;

/** Frozen bundle version. Bumping breaks consumers; see SPEC.md "Versioning". */
export const TRACE_BUNDLE_VERSION = "v0" as const;

/** Frozen viewer URL shape. Callers MUST NOT hardcode paths; use this template. */
export const TRACE_VIEWER_ROUTES = {
	html: (domain: string, id: string) => `https://${domain}/r/${id}`,
	json: (domain: string, id: string) => `https://${domain}/r/${id}.json`,
	video: (domain: string, id: string) => `https://${domain}/r/${id}/video.webm`,
	videoUrlMint: (domain: string, id: string) => `https://${domain}/r/${id}/video-url`,
	trace: (domain: string, id: string) => `https://${domain}/r/${id}/trace`,
	meta: (domain: string, id: string) => `https://${domain}/r/${id}/meta`,
} as const;

/** Default viewer domain used by the hosted unsurf deploy. */
export const TRACE_DEFAULT_VIEWER_DOMAIN = "trace.coey.dev";

/** Default ingest endpoint (same Worker in v0.0.1). */
export const TRACE_DEFAULT_INGEST_ENDPOINT = "https://trace.coey.dev";

/**
 * One-call helper: record against a local `agent-browser` session, upload
 * via HTTP ingest, return the canonical trace URL.
 *
 * Reads env:
 *   TRACE_INGEST_ENDPOINT  defaults to https://trace.coey.dev
 *   TRACE_INGEST_TOKEN     required
 */
export async function recordLocal(
	opts: RecordOptions & { provider?: LocalProviderOptions; harness?: string },
): Promise<RecordResult> {
	const endpoint = process.env.TRACE_INGEST_ENDPOINT || TRACE_DEFAULT_INGEST_ENDPOINT;
	const token = process.env.TRACE_INGEST_TOKEN;
	if (!token) {
		throw new Error(
			"recordLocal: TRACE_INGEST_TOKEN env var is required. See src/skills/record/README.md.",
		);
	}
	return _record(opts, {
		openBrowser: () => openLocalBrowser(opts.provider ?? {}),
		uploader: makeHttpUploader({ endpoint, token }),
		provider: "local",
		...(opts.harness ? { harness: opts.harness } : {}),
	});
}
