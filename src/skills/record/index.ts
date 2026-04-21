/**
 * trace skill — public entry point.
 *
 * Phase 0: type surface only. Runtime (`record()`) lands in Phase 1 (Track A).
 * Providers land in Phase 3 (local), Phase 4 (filepath), Phase 5 (BR).
 *
 * See ./SPEC.md for the bundle shape.
 * See ./SECURITY.md for the two-Worker split.
 */

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

/** Frozen id regex. Any producer that emits a non-matching id is in error. */
export const TRACE_ID_REGEX = /^[0-9a-z]{12}$/;

/** Frozen bundle version. Bumping breaks consumers; see SPEC.md "Versioning". */
export const TRACE_BUNDLE_VERSION = "v0" as const;

/** Frozen viewer URL shape. Callers MUST NOT hardcode paths; use this template. */
export const TRACE_VIEWER_ROUTES = {
	html: (domain: string, id: string) => `https://${domain}/r/${id}`,
	json: (domain: string, id: string) => `https://${domain}/r/${id}.json`,
	video: (domain: string, id: string) => `https://${domain}/r/${id}/video.webm`,
	trace: (domain: string, id: string) => `https://${domain}/r/${id}/trace`,
	meta: (domain: string, id: string) => `https://${domain}/r/${id}/meta`,
} as const;

/** Default viewer domain used by the hosted unsurf deploy. */
export const TRACE_DEFAULT_VIEWER_DOMAIN = "unsurf.coey.dev";
