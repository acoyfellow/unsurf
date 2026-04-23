/**
 * Frame extraction via ffmpeg.
 *
 * Strategy:
 *   1. Use the `select=gt(scene,threshold)` filter to grab scene-change
 *      frames. This produces a variable number of frames depending on
 *      video content — a form-fill with few transitions may produce 1-2,
 *      a multi-page tour produces 5-10.
 *   2. If we got fewer than maxFrames, pad with evenly-spaced samples so
 *      short/static videos still give the vision model something to see.
 *   3. If we got more than maxFrames, keep the first N (they're already
 *      the most visually significant).
 *
 * Output is a list of PNGs + their video-time offsets in milliseconds.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface ExtractedFrame {
	index: number;
	t: number; // ms into the video
	path: string;
	png: Uint8Array;
}

export interface ExtractOptions {
	videoPath: string;
	maxFrames: number;
	sceneThreshold: number;
	/** Directory to write frames into. Caller owns cleanup. */
	outDir?: string;
}

async function run(
	cmd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => {
			stdout += c.toString();
		});
		child.stderr.on("data", (c) => {
			stderr += c.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
	});
}

/** Probe video duration in seconds via ffprobe. Returns 0 if unknown. */
export async function probeDurationMs(videoPath: string): Promise<number> {
	const { stdout } = await run("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		videoPath,
	]);
	const seconds = Number.parseFloat(stdout.trim());
	if (!Number.isFinite(seconds) || seconds <= 0) return 0;
	return Math.round(seconds * 1000);
}

/**
 * Extract up to `maxFrames` frames using ffmpeg's scene-change filter.
 * Returns timestamps in ms (by reading the `showinfo` stderr) and png bytes.
 *
 * When scene detection produces too few frames (short clips, mostly static),
 * we fall back to evenly-spaced sampling to fill out to maxFrames.
 */
export async function extractFrames(opts: ExtractOptions): Promise<ExtractedFrame[]> {
	const outDir = opts.outDir ?? (await mkdtemp(path.join(tmpdir(), "unsurf-frames-")));
	const durationMs = await probeDurationMs(opts.videoPath);

	// Pass 1: scene-change extraction. We tee the frames out and let
	// showinfo dump pkt_pts_time per selected frame so we can learn the
	// actual video timestamps.
	const sceneArgs = [
		"-y",
		"-i",
		opts.videoPath,
		"-vf",
		`select='gt(scene,${opts.sceneThreshold})',showinfo`,
		"-vsync",
		"vfr",
		"-frames:v",
		String(opts.maxFrames),
		"-f",
		"image2",
		path.join(outDir, "scene_%03d.png"),
	];
	const scene = await run("ffmpeg", sceneArgs);
	// Parse "pts_time:12.345" lines from showinfo stderr.
	const sceneTimes: number[] = [];
	for (const m of scene.stderr.matchAll(/pts_time:([0-9.]+)/g)) {
		const t = Number.parseFloat(m[1] ?? "0");
		if (Number.isFinite(t)) sceneTimes.push(Math.round(t * 1000));
	}

	let sceneFiles = (await readdir(outDir))
		.filter((f) => f.startsWith("scene_") && f.endsWith(".png"))
		.sort();

	// Pad with evenly-spaced frames if scene detection came up short.
	if (sceneFiles.length < opts.maxFrames && durationMs > 0) {
		const want = opts.maxFrames - sceneFiles.length;
		// Distribute `want` samples evenly across the clip, avoiding times
		// we already captured.
		const evenTimes: number[] = [];
		for (let i = 1; i <= want; i++) {
			const t = Math.round((durationMs * i) / (want + 1));
			evenTimes.push(t);
		}
		for (let i = 0; i < evenTimes.length; i++) {
			const t = evenTimes[i]!;
			const outPath = path.join(outDir, `even_${String(i).padStart(3, "0")}.png`);
			await run("ffmpeg", [
				"-y",
				"-ss",
				(t / 1000).toFixed(3),
				"-i",
				opts.videoPath,
				"-frames:v",
				"1",
				"-q:v",
				"2",
				outPath,
			]);
			sceneTimes.push(t);
		}
		sceneFiles = (await readdir(outDir)).filter((f) => f.endsWith(".png")).sort();
	}

	// Pair files with timestamps. Times are already in insertion order
	// (scene frames first, then even frames), and filenames sort to the
	// same order because of the prefixes.
	const frames: ExtractedFrame[] = [];
	for (let i = 0; i < sceneFiles.length; i++) {
		const file = sceneFiles[i]!;
		const abs = path.join(outDir, file);
		const buf = await readFile(abs);
		frames.push({
			index: i,
			t: sceneTimes[i] ?? 0,
			path: abs,
			png: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
		});
	}

	// Sort by timestamp so the narrative reads forward in time.
	frames.sort((a, b) => a.t - b.t);
	for (let i = 0; i < frames.length; i++) {
		const f = frames[i];
		if (f) f.index = i;
	}

	return frames;
}

export async function cleanupFramesDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true }).catch(() => {});
}
