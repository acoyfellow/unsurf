/**
 * Unit coverage for the trace skill core. Providers are tested separately
 * (local provider needs a real `agent-browser` and is covered by the demo).
 */

import { describe, expect, it } from "vitest";
import { newTraceId } from "../src/skills/record/id.js";
import { TRACE_ID_REGEX, TRACE_VIEWER_ROUTES } from "../src/skills/record/index.js";
import { record } from "../src/skills/record/record.js";
import { traceHandle } from "../src/skills/record/tracer.js";
import type { BrowserHandle, Bundle, Uploader, UploadResult } from "../src/skills/record/types.js";

function stubBrowser(overrides: Partial<BrowserHandle> = {}): BrowserHandle {
	return {
		goto: async () => {},
		click: async () => {},
		fill: async () => {},
		wait: async () => {},
		snapshot: async () => ({ ok: true }),
		screenshot: async () => new Uint8Array([1, 2, 3]),
		startRecording: async () => {},
		stopRecording: async () => {},
		close: async () => {},
		...overrides,
	};
}

function captureUploader(): { uploader: Uploader; uploaded: Bundle[] } {
	const uploaded: Bundle[] = [];
	const uploader: Uploader = {
		async upload(bundle) {
			uploaded.push(bundle);
			const url = `https://trace.coey.dev/r/${bundle.id}`;
			const result: UploadResult = {
				url,
				resultUrl: `${url}.json`,
				...(bundle.video ? { videoUrl: `${url}/video.webm?exp=1&sig=x` } : {}),
			};
			return result;
		},
	};
	return { uploader, uploaded };
}

describe("newTraceId", () => {
	it("produces 12-char base36 matching the frozen regex", () => {
		for (let i = 0; i < 20; i++) {
			const id = newTraceId();
			expect(id).toMatch(TRACE_ID_REGEX);
		}
	});
});

describe("TRACE_VIEWER_ROUTES", () => {
	it("builds all routes under the same id", () => {
		const id = "abcdef012345";
		const d = "trace.coey.dev";
		expect(TRACE_VIEWER_ROUTES.html(d, id)).toBe(`https://${d}/r/${id}`);
		expect(TRACE_VIEWER_ROUTES.json(d, id)).toBe(`https://${d}/r/${id}.json`);
		expect(TRACE_VIEWER_ROUTES.video(d, id)).toBe(`https://${d}/r/${id}/video.webm`);
		expect(TRACE_VIEWER_ROUTES.trace(d, id)).toBe(`https://${d}/r/${id}/trace`);
		expect(TRACE_VIEWER_ROUTES.meta(d, id)).toBe(`https://${d}/r/${id}/meta`);
	});
});

describe("traceHandle", () => {
	it("records every call with args, status, and duration", async () => {
		const { handle, steps } = traceHandle(stubBrowser());
		await handle.goto("https://example.com");
		await handle.click("button.primary");
		await handle.fill("input[name=q]", "hello world");
		await handle.wait(10);
		expect(steps).toHaveLength(4);
		expect(steps[0]).toMatchObject({
			op: "goto",
			status: "ok",
			args: { url: "https://example.com" },
		});
		expect(steps[1]!.args).toEqual({ selector: "button.primary" });
		expect(steps[2]!.args).toEqual({ selector: "input[name=q]", value: "hello world" });
		expect(steps[3]!.args).toEqual({ ms: 10 });
		for (const s of steps) expect(typeof s.durationMs).toBe("number");
	});

	it("records thrown errors and re-throws", async () => {
		const { handle, steps } = traceHandle(
			stubBrowser({
				click: async () => {
					throw new Error("element not found");
				},
			}),
		);
		await expect(handle.click(".missing")).rejects.toThrow("element not found");
		expect(steps).toHaveLength(1);
		expect(steps[0]!.status).toBe("err");
		expect(steps[0]!.error).toContain("element not found");
	});

	it("truncates long fill values", async () => {
		const { handle, steps } = traceHandle(stubBrowser());
		await handle.fill("input", "x".repeat(200));
		expect((steps[0]!.args.value as string).length).toBeLessThanOrEqual(81);
		expect(steps[0]!.args.value).toMatch(/…$/);
	});

	it("does not trace startRecording / stopRecording / close", async () => {
		const { handle, steps } = traceHandle(stubBrowser());
		await handle.startRecording("/tmp/x.webm");
		await handle.stopRecording();
		await handle.close();
		expect(steps).toHaveLength(0);
	});
});

describe("record()", () => {
	it("produces a bundle with trace steps, result=succeeded, and a viewer URL", async () => {
		const { uploader, uploaded } = captureUploader();
		const res = await record(
			{
				task: "demo",
				run: async (b) => {
					await b.goto("https://example.com");
					await b.click("a");
					return { ok: true };
				},
			},
			{
				openBrowser: async () => stubBrowser(),
				uploader,
				provider: "local",
				harness: "test",
			},
		);
		expect(res.status).toBe("succeeded");
		expect(res.url).toMatch(/^https:\/\/trace\.coey\.dev\/r\/[0-9a-z]{12}$/);
		expect(res.returned).toEqual({ ok: true });
		expect(uploaded).toHaveLength(1);
		const b = uploaded[0]!;
		expect(b.trace.steps.map((s) => s.op)).toEqual(["goto", "click"]);
		expect(b.result.task).toBe("demo");
		expect(b.meta.harness).toBe("test");
		expect(b.meta.provider).toBe("local");
	});

	it("marks status=failed when the callback throws but still uploads", async () => {
		const { uploader, uploaded } = captureUploader();
		const res = await record(
			{
				task: "fail-case",
				run: async () => {
					throw new Error("boom");
				},
			},
			{
				openBrowser: async () => stubBrowser(),
				uploader,
				provider: "local",
			},
		);
		expect(res.status).toBe("failed");
		expect(res.error).toBe("boom");
		expect(uploaded).toHaveLength(1);
		expect(uploaded[0]!.result.status).toBe("failed");
		expect(uploaded[0]!.result.error).toBe("boom");
	});

	it("attaches localPath on the thrown error when upload fails", async () => {
		const uploader: Uploader = {
			async upload() {
				throw new Error("R2 down");
			},
		};
		try {
			await record(
				{ task: "t", run: async () => {} },
				{ openBrowser: async () => stubBrowser(), uploader, provider: "local" },
			);
			throw new Error("record() should have thrown");
		} catch (e) {
			const err = e as Error & { localPath?: string };
			expect(err.message).toBe("R2 down");
			expect(err.localPath).toMatch(/unsurf-trace-/);
		}
	});
});
