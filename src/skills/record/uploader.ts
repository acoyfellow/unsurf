/**
 * HTTP uploader — POST multipart bundle to the trace ingest Worker. This is
 * the default uploader for the local provider. Sandbox-resident callers will
 * ship a direct-R2 uploader later (Phase 4).
 */

import type { Bundle, Uploader, UploadResult } from "./types.js";

export interface HttpUploaderOptions {
	/** Base origin, e.g. `https://trace.coey.dev`. No trailing slash. */
	endpoint: string;
	/** Bearer token for the ingest Worker. Required. */
	token: string;
	/** Custom fetch implementation (for tests). Defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

export function makeHttpUploader(opts: HttpUploaderOptions): Uploader {
	const endpoint = opts.endpoint.replace(/\/+$/, "");
	const fetchFn = opts.fetchImpl ?? fetch;
	return {
		async upload(bundle: Bundle): Promise<UploadResult> {
			const form = new FormData();
			form.set("id", bundle.id);
			form.set(
				"trace",
				new Blob([JSON.stringify(bundle.trace)], { type: "application/json" }),
				"trace.json",
			);
			form.set(
				"result",
				new Blob([JSON.stringify(bundle.result)], { type: "application/json" }),
				"result.json",
			);
			form.set(
				"meta",
				new Blob([JSON.stringify(bundle.meta)], { type: "application/json" }),
				"meta.json",
			);
			if (bundle.video && bundle.video.byteLength > 0) {
				// Copy into a fresh ArrayBuffer so the Blob owns a tight view.
				const ab = bundle.video.buffer.slice(
					bundle.video.byteOffset,
					bundle.video.byteOffset + bundle.video.byteLength,
				) as ArrayBuffer;
				form.set("video", new Blob([ab], { type: "video/webm" }), `${bundle.id}.webm`);
			}
			const res = await fetchFn(`${endpoint}/upload`, {
				method: "POST",
				headers: { authorization: `Bearer ${opts.token}` },
				body: form,
			});
			if (!res.ok) {
				const detail = await res.text().catch(() => "");
				throw new Error(`trace upload failed (${res.status}): ${detail.slice(0, 300)}`);
			}
			return (await res.json()) as UploadResult;
		},
	};
}
