/**
 * Unit tests for the loop skill.
 *
 * Covers:
 *   - interpret/validateSpec: rejects malformed ops, accepts valid shapes
 *   - interpret/runSpec: walks a spec in order against a stub BrowserHandle
 *   - loop(): stops on met, refines and retries on not-met,
 *     respects error budget, hits maxIterations
 *
 * All network / agent-browser dependencies are injected. No outbound
 * calls during tests.
 */

import { describe, expect, it } from "vitest";
import { runSpec, validateSpec } from "../src/skills/loop/interpret.js";
import { loop } from "../src/skills/loop/loop.js";
import type { LoopSpec, ObserveFn, Planner, RecordFn, Refiner } from "../src/skills/loop/types.js";
import type { BrowserHandle } from "../src/skills/record/types.js";

function stubBrowser() {
	const calls: { op: string; args: unknown[] }[] = [];
	const push =
		(op: string) =>
		(...args: unknown[]) => {
			calls.push({ op, args });
			return Promise.resolve(op === "snapshot" ? { ok: true } : undefined);
		};
	const handle: BrowserHandle = {
		goto: push("goto") as BrowserHandle["goto"],
		click: push("click") as BrowserHandle["click"],
		fill: push("fill") as BrowserHandle["fill"],
		wait: push("wait") as BrowserHandle["wait"],
		snapshot: push("snapshot") as BrowserHandle["snapshot"],
		screenshot: (async () => new Uint8Array()) as BrowserHandle["screenshot"],
		startRecording: push("startRecording") as BrowserHandle["startRecording"],
		stopRecording: push("stopRecording") as BrowserHandle["stopRecording"],
		close: push("close") as BrowserHandle["close"],
	};
	return { handle, calls };
}

describe("validateSpec", () => {
	it("accepts a minimal valid spec", () => {
		const s = validateSpec({ steps: [{ op: "snapshot" }] });
		expect(s.steps).toHaveLength(1);
	});

	it("accepts every op with its required fields", () => {
		const s: LoopSpec = {
			url: "https://example.com",
			steps: [
				{ op: "goto", url: "https://x.com" },
				{ op: "fill", selector: "input", value: "hi" },
				{ op: "click", selector: "button" },
				{ op: "wait", ms: 100 },
				{ op: "waitFor", selector: "#done" },
				{ op: "snapshot" },
			],
		};
		expect(() => validateSpec(s)).not.toThrow();
	});

	it("rejects non-object spec", () => {
		expect(() => validateSpec("nope")).toThrow();
		expect(() => validateSpec(null)).toThrow();
	});

	it("rejects missing steps array", () => {
		expect(() => validateSpec({})).toThrow(/steps must be an array/);
	});

	it("rejects unknown op", () => {
		expect(() => validateSpec({ steps: [{ op: "fly" }] })).toThrow(/not a valid op/);
	});

	it("rejects fill without selector+value", () => {
		expect(() => validateSpec({ steps: [{ op: "fill", selector: "x" }] })).toThrow(
			/fill needs selector\+value/,
		);
	});

	it("rejects wait without numeric ms", () => {
		expect(() => validateSpec({ steps: [{ op: "wait", ms: "fast" }] })).toThrow(
			/ms must be a number/,
		);
	});
});

describe("runSpec", () => {
	it("navigates to url before steps", async () => {
		const { handle, calls } = stubBrowser();
		await runSpec({ url: "https://a", steps: [{ op: "snapshot" }] }, handle);
		expect(calls[0]).toEqual({ op: "goto", args: ["https://a"] });
		expect(calls[1]?.op).toBe("snapshot");
	});

	it("runs steps in order", async () => {
		const { handle, calls } = stubBrowser();
		await runSpec(
			{
				steps: [
					{ op: "goto", url: "https://x" },
					{ op: "fill", selector: "input", value: "v" },
					{ op: "click", selector: "button" },
					{ op: "wait", ms: 10 },
					{ op: "waitFor", selector: "#ok", timeoutMs: 1000 },
				],
			},
			handle,
		);
		expect(calls.map((c) => c.op)).toEqual(["goto", "fill", "click", "wait", "wait"]);
		// waitFor expands to wait({ selector, timeoutMs })
		expect(calls[4]?.args[0]).toEqual({ selector: "#ok", timeoutMs: 1000 });
	});
});

// ==================== loop() orchestration ====================

interface CallCounter {
	calls: number;
}

function mkRecordFn(): RecordFn & CallCounter {
	const fn = (async () => {
		out.calls++;
		return { traceUrl: `https://trace/r/${out.calls}`, videoPath: `/tmp/v${out.calls}.webm` };
	}) as RecordFn;
	// Attach mutable counter directly on the function object so assertions
	// see the increment after await.
	const out = Object.assign(fn, { calls: 0 });
	return out;
}

function mkObserveFn(answers: { answer: string; confidence: number }[]): ObserveFn & CallCounter {
	const fn = (async () => {
		const a = answers[out.calls] ?? answers[answers.length - 1]!;
		out.calls++;
		return a;
	}) as ObserveFn;
	const out = Object.assign(fn, { calls: 0 });
	return out;
}

function mkRefiner(next: LoopSpec | null): Refiner & { calls: number } {
	const r = {
		calls: 0,
		async refine() {
			r.calls++;
			return next;
		},
	};
	return r;
}

const seedSpec: LoopSpec = { steps: [{ op: "snapshot" }] };

describe("loop()", () => {
	it("stops immediately on met", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([{ answer: "Yes, succeeded", confidence: 0.95 }]);
		const refiner = mkRefiner(seedSpec);

		const result = await loop({
			spec: seedSpec,
			northStar: "did it work?",
			recordFn: record,
			observeFn: observe,
			refiner,
		});

		expect(result.met).toBe(true);
		expect(result.stopReason).toBe("met");
		expect(result.iterations).toHaveLength(1);
		expect(record.calls).toBe(1);
		expect(refiner.calls).toBe(0);
	});

	it("refines and retries when not met", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([
			{ answer: "No, the field was empty", confidence: 0.9 },
			{ answer: "Yes, completed successfully", confidence: 0.95 },
		]);
		const refiner = mkRefiner({
			steps: [{ op: "fill", selector: "input", value: "Jordan" }, { op: "snapshot" }],
		});

		const result = await loop({
			spec: seedSpec,
			northStar: "did it fill the field?",
			maxIterations: 4,
			recordFn: record,
			observeFn: observe,
			refiner,
		});

		expect(result.met).toBe(true);
		expect(result.iterations).toHaveLength(2);
		expect(record.calls).toBe(2);
		expect(refiner.calls).toBe(1);
		// Second iteration runs the refined spec.
		expect(result.iterations[1]?.spec.steps[0]).toEqual({
			op: "fill",
			selector: "input",
			value: "Jordan",
		});
	});

	it("aborts when refiner returns null (giveUp)", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([{ answer: "No", confidence: 0.9 }]);
		const refiner = mkRefiner(null);

		const result = await loop({
			spec: seedSpec,
			northStar: "impossible goal",
			recordFn: record,
			observeFn: observe,
			refiner,
		});

		expect(result.met).toBe(false);
		expect(result.stopReason).toBe("abort");
		expect(record.calls).toBe(1);
		expect(refiner.calls).toBe(1);
	});

	it("stops at maxIterations when never met", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([{ answer: "No", confidence: 0.9 }]);
		const refiner = mkRefiner(seedSpec);

		const result = await loop({
			spec: seedSpec,
			northStar: "unreachable",
			maxIterations: 3,
			recordFn: record,
			observeFn: observe,
			refiner,
		});

		expect(result.met).toBe(false);
		expect(result.stopReason).toBe("maxIterations");
		// 3 records, 2 refines (skipped after last tick).
		expect(record.calls).toBe(3);
		expect(refiner.calls).toBe(2);
	});

	it("respects error budget and stops on 3 consecutive errors", async () => {
		const brokenRecord: RecordFn = async () => {
			throw new Error("agent-browser exploded");
		};
		const observe = mkObserveFn([{ answer: "N/A", confidence: 0 }]);
		const refiner = mkRefiner(seedSpec);

		const result = await loop({
			spec: seedSpec,
			northStar: "anything",
			maxIterations: 10,
			recordFn: brokenRecord,
			observeFn: observe,
			refiner,
		});

		expect(result.met).toBe(false);
		expect(result.stopReason).toBe("errorBudget");
		// 3 failing iterations, each marked with error.
		const errored = result.iterations.filter((t) => t.error);
		expect(errored.length).toBeGreaterThanOrEqual(3);
	});

	it("uses planner when given a string spec", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([{ answer: "Yes", confidence: 0.95 }]);
		const refiner = mkRefiner(seedSpec);
		const planner: Planner & { calls: number } = {
			calls: 0,
			async plan() {
				planner.calls++;
				return { steps: [{ op: "snapshot" }] };
			},
		};

		const result = await loop({
			spec: "Do the thing on example.com",
			northStar: "did it?",
			recordFn: record,
			observeFn: observe,
			refiner,
			planner,
		});

		expect(planner.calls).toBe(1);
		expect(result.met).toBe(true);
	});

	it("low-confidence answer does not count as met even with positive wording", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([
			{ answer: "Yes, probably", confidence: 0.4 },
			{ answer: "Yes, completed", confidence: 0.95 },
		]);
		const refiner = mkRefiner(seedSpec);

		const result = await loop({
			spec: seedSpec,
			northStar: "check",
			maxIterations: 3,
			recordFn: record,
			observeFn: observe,
			refiner,
		});

		expect(result.met).toBe(true);
		// First iteration should not be met due to confidence.
		expect(result.iterations[0]?.met).toBe(false);
		expect(result.iterations[1]?.met).toBe(true);
	});

	it("onTick is called once per iteration", async () => {
		const record = mkRecordFn();
		const observe = mkObserveFn([
			{ answer: "No", confidence: 0.9 },
			{ answer: "Yes, done", confidence: 0.95 },
		]);
		const refiner = mkRefiner(seedSpec);
		const ticks: number[] = [];

		await loop({
			spec: seedSpec,
			northStar: "x",
			recordFn: record,
			observeFn: observe,
			refiner,
			onTick: (t) => ticks.push(t.iteration),
		});

		expect(ticks).toEqual([0, 1]);
	});
});
