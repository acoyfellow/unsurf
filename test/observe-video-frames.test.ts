/**
 * Unit tests for observe-video/frames.ts — the ffmpeg-backed frame extractor.
 *
 * These tests generate a synthetic video with ffmpeg so we don't depend on
 * any fixture asset on disk. They're skipped automatically if ffmpeg/ffprobe
 * aren't available in the test env (e.g. some CI runners).
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	cleanupFramesDir,
	extractFrames,
	probeDurationMs,
} from "../src/skills/observe-video/frames.js";

async function hasBin(bin: string): Promise<boolean> {
	return new Promise((resolve) => {
		const c = spawn(bin, ["-version"], { stdio: "ignore" });
		c.on("error", () => resolve(false));
		c.on("close", (code) => resolve(code === 0));
	});
}

async function makeTestVideo(dir: string): Promise<string> {
	// 3s video with frequent scene changes: testsrc2 animates aggressively.
	const out = path.join(dir, "test.mp4");
	await new Promise<void>((resolve, reject) => {
		const c = spawn(
			"ffmpeg",
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				"testsrc2=size=320x240:rate=10:duration=3",
				"-pix_fmt",
				"yuv420p",
				out,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let stderr = "";
		c.stderr?.on("data", (d) => {
			stderr += d.toString();
		});
		c.on("error", reject);
		c.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`)),
		);
	});
	return out;
}

// Probe at module load so skipIf can see the result when it.skipIf() runs.
const ffmpegAvailable = await hasBin("ffmpeg");
const ffprobeAvailable = await hasBin("ffprobe");
const canRun = ffmpegAvailable && ffprobeAvailable;

describe("observe-video frames", () => {
	let tmpDir = "";
	let videoPath = "";

	beforeAll(async () => {
		if (!canRun) return;
		tmpDir = await mkdtemp(path.join(tmpdir(), "unsurf-frames-test-"));
		videoPath = await makeTestVideo(tmpDir);
	});

	afterAll(async () => {
		if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	it.skipIf(!canRun)("probeDurationMs returns video duration", async () => {
		const ms = await probeDurationMs(videoPath);
		// Our synthetic video is ~3s. Give it a loose bound.
		expect(ms).toBeGreaterThanOrEqual(2500);
		expect(ms).toBeLessThanOrEqual(4000);
	});

	it.skipIf(!canRun)("extractFrames returns requested number of frames", async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), "unsurf-frames-out-"));
		try {
			const frames = await extractFrames({
				videoPath,
				maxFrames: 4,
				sceneThreshold: 0.3,
				outDir,
			});
			expect(frames.length).toBeGreaterThanOrEqual(2); // at minimum the two scene changes
			expect(frames.length).toBeLessThanOrEqual(4);
			for (const f of frames) {
				expect(f.png.byteLength).toBeGreaterThan(100);
				expect(f.t).toBeGreaterThanOrEqual(0);
			}
			// Sorted by time.
			for (let i = 1; i < frames.length; i++) {
				expect(frames[i]!.t).toBeGreaterThanOrEqual(frames[i - 1]!.t);
			}
			// Indices are 0..n-1 after the sort.
			expect(frames.map((f) => f.index)).toEqual(frames.map((_, i) => i));
		} finally {
			await cleanupFramesDir(outDir);
		}
	});

	it.skipIf(!canRun)("extractFrames pads with evenly-spaced samples", async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), "unsurf-frames-out-"));
		try {
			const frames = await extractFrames({
				videoPath,
				maxFrames: 6,
				sceneThreshold: 0.99, // so strict that scene detection finds ~0-1 frames
				outDir,
			});
			// Padding should kick in and get us up toward 6.
			expect(frames.length).toBeGreaterThanOrEqual(4);
		} finally {
			await cleanupFramesDir(outDir);
		}
	});
});
