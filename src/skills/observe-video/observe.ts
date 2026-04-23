/**
 * observeVideo() — orchestrator.
 *
 * Pipeline:
 *   1. Resolve `video` to a local path (downloading from http(s) if needed).
 *   2. Extract keyframes via ffmpeg scene-change detection.
 *   3. Caption each frame concurrently via the vision backend.
 *   4. Synthesize final { answer, confidence } via the text backend.
 *   5. Clean up temp frames unless caller asked to keep them.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workersAiSynthesisBackend, workersAiVisionBackend } from "./backends/workers-ai.js";
import { cleanupFramesDir, extractFrames } from "./frames.js";
import type { FrameEvidence, ObserveOptions, ObserveResult } from "./types.js";

async function resolveVideoPath(
	video: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	if (/^https?:\/\//.test(video)) {
		const res = await fetch(video);
		if (!res.ok) throw new Error(`observeVideo: fetch ${video} failed ${res.status}`);
		const buf = new Uint8Array(await res.arrayBuffer());
		const dir = await mkdtemp(path.join(tmpdir(), "unsurf-observe-"));
		// Keep the original extension if we can guess it; otherwise trust ffmpeg.
		const ext = video.match(/\.(webm|mp4|mov|mkv)(?:\?|$)/i)?.[1] || "webm";
		const abs = path.join(dir, `video.${ext}`);
		await writeFile(abs, buf);
		return {
			path: abs,
			cleanup: async () => {
				await cleanupFramesDir(dir);
			},
		};
	}
	return { path: video, cleanup: async () => {} };
}

export async function observeVideo(opts: ObserveOptions): Promise<ObserveResult> {
	const maxFrames = opts.maxFrames ?? 8;
	const sceneThreshold = opts.sceneThreshold ?? 0.3;
	const vision = opts.visionBackend ?? workersAiVisionBackend();
	const synthesis = opts.synthesisBackend ?? workersAiSynthesisBackend();

	const { path: videoPath, cleanup: cleanupVideo } = await resolveVideoPath(opts.video);

	const framesDir = await mkdtemp(path.join(tmpdir(), "unsurf-frames-"));
	let frames: Awaited<ReturnType<typeof extractFrames>> = [];
	try {
		frames = await extractFrames({
			videoPath,
			maxFrames,
			sceneThreshold,
			outDir: framesDir,
		});
		if (frames.length === 0) {
			throw new Error("observeVideo: extracted 0 frames — video may be empty or unreadable");
		}

		// Caption frames concurrently, but cap the parallelism so the
		// Workers AI account isn't hammered. 3 is a safe default on the
		// current rate limits.
		const PARALLEL = 3;
		const captions: { t: number; caption: string }[] = new Array(frames.length);
		for (let i = 0; i < frames.length; i += PARALLEL) {
			const slice = frames.slice(i, i + PARALLEL);
			const results = await Promise.all(
				slice.map(async (f) => ({ t: f.t, caption: await vision.caption(f), index: f.index })),
			);
			for (const r of results) captions[r.index] = { t: r.t, caption: r.caption };
		}

		const syn = await synthesis.synthesize({ question: opts.question, captions });

		const evidenceFrames: FrameEvidence[] = frames.map((f) => ({
			index: f.index,
			t: f.t,
			path: f.path,
			caption: captions[f.index]?.caption ?? "",
		}));

		return {
			answer: syn.answer,
			confidence: syn.confidence,
			evidenceFrames,
			raw: { synthesis: syn.raw },
		};
	} finally {
		if (!opts.keepFrames) {
			await cleanupFramesDir(framesDir);
		}
		await cleanupVideo();
	}
}
