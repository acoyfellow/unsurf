#!/usr/bin/env bun
/**
 * Post-deploy live verification. Runs in CI after `bun run deploy`.
 *
 * Proves:
 *   Phase 1 — per-token KV auth + rate limit
 *     • admin mint → returns a token
 *     • upload with minted token → 200
 *     • upload with a random/bogus token → 401
 *     • admin revoke → 200
 *     • upload with revoked token → 401
 *     • legacy TRACE_INGEST_TOKEN still works → 200
 *
 *   Phase 2 — observeVideo end-to-end
 *     • synthesize a 3s scene-changing video with ffmpeg
 *     • run observeVideo({ question: "What colors appear?" })
 *     • assert answer mentions color / pattern words
 *
 * Env (all from CI secrets):
 *   CLOUDFLARE_API_TOKEN       — Workers AI + upload fixture
 *   CLOUDFLARE_ACCOUNT_ID
 *   TRACE_INGEST_TOKEN         — root/legacy token
 *   TRACE_INGEST_ENDPOINT      — defaults to https://trace.coey.dev
 *
 * Exits non-zero on any failure so CI turns red.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { observeVideo } from "../src/skills/observe-video/index.js";

const ENDPOINT = process.env.TRACE_INGEST_ENDPOINT || "https://trace.coey.dev";
const ROOT = process.env.TRACE_INGEST_TOKEN;
if (!ROOT) {
	console.error("verify-post-deploy: TRACE_INGEST_TOKEN is required");
	process.exit(1);
}
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
	console.error(
		"verify-post-deploy: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required (for Workers AI)",
	);
	process.exit(1);
}

let failures = 0;
function pass(msg: string): void {
	console.log(`  ✓ ${msg}`);
}
function fail(msg: string, detail?: unknown): void {
	failures++;
	console.error(`  ✗ ${msg}${detail ? `\n    ${JSON.stringify(detail)}` : ""}`);
}
function section(name: string): void {
	console.log(`\n=== ${name} ===`);
}

async function expectStatus(
	label: string,
	res: Response,
	want: number | number[],
): Promise<unknown> {
	const body = (await res.json().catch(() => null)) as unknown;
	const wants = Array.isArray(want) ? want : [want];
	if (wants.includes(res.status)) {
		pass(`${label} → ${res.status}`);
	} else {
		fail(`${label} → expected ${wants.join("|")}, got ${res.status}`, body);
	}
	return body;
}

async function spawnAndWait(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		c.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		c.on("error", reject);
		c.on("close", (code) =>
			code === 0
				? resolve(stderr)
				: reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-300)}`)),
		);
	});
}

function mkId(): string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
	let out = "";
	for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
	return out;
}

async function postBundle(
	token: string,
	id: string,
	opts: { visibility?: "public" | "private" } = {},
): Promise<Response> {
	const now = new Date().toISOString();
	const form = new FormData();
	form.set("id", id);
	form.set(
		"trace",
		new Blob([JSON.stringify({ version: "v0", id, startedAt: now, finishedAt: now, steps: [] })], {
			type: "application/json",
		}),
		"trace.json",
	);
	form.set(
		"result",
		new Blob(
			[
				JSON.stringify({
					version: "v0",
					id,
					status: "succeeded",
					startedAt: now,
					finishedAt: now,
					durationMs: 0,
					task: "verify-post-deploy",
				}),
			],
			{ type: "application/json" },
		),
		"result.json",
	);
	form.set(
		"meta",
		new Blob(
			[
				JSON.stringify({
					version: "v0",
					id,
					task: "verify-post-deploy",
					provider: "local",
					harness: "ci",
					...(opts.visibility ? { visibility: opts.visibility } : {}),
				}),
			],
			{ type: "application/json" },
		),
		"meta.json",
	);
	return fetch(`${ENDPOINT}/upload`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}` },
		body: form,
	});
}

async function mintToken(owner: string): Promise<string> {
	const res = await fetch(`${ENDPOINT}/admin/tokens`, {
		method: "POST",
		headers: { authorization: `Bearer ${ROOT}`, "content-type": "application/json" },
		body: JSON.stringify({ owner }),
	});
	if (!res.ok) throw new Error(`mintToken failed ${res.status}: ${await res.text()}`);
	const data = (await res.json()) as { token: string; owner: string };
	return data.token;
}

async function revokeToken(token: string): Promise<Response> {
	return fetch(`${ENDPOINT}/admin/tokens/revoke`, {
		method: "POST",
		headers: { authorization: `Bearer ${ROOT}`, "content-type": "application/json" },
		body: JSON.stringify({ token }),
	});
}

// ==================== Phase 1 ====================

section("Phase 1: ingest auth matrix");

const minted = await mintToken(`ci-verify-${Date.now()}`);
pass("minted a fresh per-owner token");

await expectStatus("upload with minted token", await postBundle(minted, mkId()), 200);
await expectStatus(
	"upload with bogus token",
	await postBundle("definitely-not-a-real-token-x".repeat(2), mkId()),
	401,
);
await expectStatus("revoke minted token", await revokeToken(minted), 200);
await expectStatus("upload with revoked token", await postBundle(minted, mkId()), 401);
await expectStatus("upload with legacy root token", await postBundle(ROOT, mkId()), 200);

// ==================== Phase 1b: privacy ====================

section("Phase 1b: private trace visibility");

const privateId = mkId();
const uploadRes = await postBundle(ROOT, privateId, { visibility: "private" });
const uploadBody = (await uploadRes.json()) as {
	visibility?: string;
	viewerUrl?: string;
	url?: string;
};
if (uploadRes.status === 200 && uploadBody.visibility === "private" && uploadBody.viewerUrl) {
	pass("private upload returned viewerUrl with ?vt= grant");
} else {
	fail("private upload did not return a signed viewer URL", uploadBody);
}

const publicHtml = await fetch(`${ENDPOINT}/r/${privateId}`);
await expectStatus("GET /r/<private-id> without grant", publicHtml, 404);
await expectStatus(
	"GET /r/<private-id>.json without grant",
	await fetch(`${ENDPOINT}/r/${privateId}.json`),
	404,
);

if (uploadBody.viewerUrl) {
	await expectStatus("GET <viewerUrl> with valid grant", await fetch(uploadBody.viewerUrl), 200);
	const viewerUrl = new URL(uploadBody.viewerUrl);
	const vt = viewerUrl.searchParams.get("vt") || "";
	await expectStatus(
		"GET /r/<private-id>/trace with valid grant",
		await fetch(`${ENDPOINT}/r/${privateId}/trace?vt=${encodeURIComponent(vt)}`),
		200,
	);
	// Tamper with the grant (flip a byte in the sig) → must 404.
	const badVt = vt.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
	await expectStatus(
		"GET /r/<private-id> with tampered grant",
		await fetch(`${ENDPOINT}/r/${privateId}?vt=${encodeURIComponent(badVt)}`),
		404,
	);
}

// Public bundles should still work without a grant.
const publicId = mkId();
await postBundle(ROOT, publicId);
await expectStatus(
	"GET /r/<public-id> without grant (public default)",
	await fetch(`${ENDPOINT}/r/${publicId}`),
	200,
);

// ==================== Phase 1c: grant revocation ====================
//
// The trace-revoke endpoint bumps a private trace's grantGeneration; all
// outstanding grants should 404 on the next request, and the fresh grant
// from the revoke response should work.

section("Phase 1c: grant revocation");

const revokeId = mkId();
const revokeUploadRes = await postBundle(ROOT, revokeId, { visibility: "private" });
const revokeUpload = (await revokeUploadRes.json()) as { viewerUrl?: string };
if (revokeUpload.viewerUrl) {
	const originalGrant = new URL(revokeUpload.viewerUrl).searchParams.get("vt") || "";
	await expectStatus(
		"pre-revoke: original grant → 200",
		await fetch(`${ENDPOINT}/r/${revokeId}?vt=${encodeURIComponent(originalGrant)}`),
		200,
	);

	const revokeRes = await fetch(`${ENDPOINT}/admin/traces/${revokeId}/revoke`, {
		method: "POST",
		headers: { authorization: `Bearer ${ROOT}` },
	});
	const revokeBody = (await revokeRes.json()) as { viewerUrl?: string };
	if (revokeRes.status === 200 && revokeBody.viewerUrl) {
		pass("POST /admin/traces/:id/revoke returned a fresh viewerUrl");
	} else {
		fail("revoke endpoint did not return a fresh viewerUrl", revokeBody);
	}

	await expectStatus(
		"post-revoke: original grant now 404",
		await fetch(`${ENDPOINT}/r/${revokeId}?vt=${encodeURIComponent(originalGrant)}`),
		404,
	);

	if (revokeBody.viewerUrl) {
		await expectStatus("post-revoke: new grant → 200", await fetch(revokeBody.viewerUrl), 200);
	}
}

// ==================== Phase 1d: OG card + embed mode ====================
//
// Both ship as part of the Stripe-flavored viewer; verify they're wired.

section("Phase 1d: OG card + embed mode");

const ogRes = await fetch(`${ENDPOINT}/r/${publicId}/og.svg`);
const ogType = ogRes.headers.get("content-type") || "";
if (ogRes.status === 200 && ogType.startsWith("image/svg+xml")) {
	pass(`GET /r/${publicId}/og.svg → 200 (${ogType})`);
} else {
	fail(`GET /r/${publicId}/og.svg expected 200 + SVG, got ${ogRes.status} ${ogType}`);
}
const ogBody = await ogRes.text();
if (ogBody.includes("<svg") && ogBody.includes(publicId.slice(0, 6))) {
	pass("OG card SVG contains trace id prefix");
} else {
	fail("OG card SVG missing expected content");
}

const viewerRes = await fetch(`${ENDPOINT}/r/${publicId}`);
const viewerHtml = await viewerRes.text();
if (viewerHtml.includes('property="og:image"') && viewerHtml.includes('name="twitter:card"')) {
	pass("viewer HTML embeds og:image + twitter:card meta tags");
} else {
	fail("viewer HTML missing OG/Twitter meta tags");
}

const embedRes = await fetch(`${ENDPOINT}/r/${publicId}?embed=1`);
const embedHtml = await embedRes.text();
if (
	embedRes.status === 200 &&
	embedHtml.includes('data-embed="1"') &&
	!viewerHtml.includes('data-embed="1"')
) {
	pass("GET /r/<id>?embed=1 → 200 with data-embed=1 attribute (default has data-embed=0)");
} else {
	fail(
		`embed mode did not toggle data-embed attribute (status=${embedRes.status}, embed-has-attr=${embedHtml.includes('data-embed="1"')}, default-has-attr=${viewerHtml.includes('data-embed="1"')})`,
	);
}

// ==================== Phase 2 ====================

section("Phase 2: observeVideo E2E");

const workDir = await mkdtemp(path.join(tmpdir(), "unsurf-verify-"));
const videoPath = path.join(workDir, "test.mp4");

try {
	// A short scene-changing video: testsrc2 cycles color bars; ffmpeg picks it up
	// as multiple scene changes at the default 0.3 threshold.
	await spawnAndWait("ffmpeg", [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"testsrc2=size=640x360:rate=10:duration=3",
		"-pix_fmt",
		"yuv420p",
		videoPath,
	]);
	const size = (await readFile(videoPath)).byteLength;
	pass(`synthesized test video (${size} bytes)`);

	const result = await observeVideo({
		video: videoPath,
		question:
			"Describe what kind of video this is. Does it appear to be a test pattern, a color bar, or real user content?",
		maxFrames: 4,
	});
	pass(`observeVideo returned an answer (${result.answer.length} chars)`);
	console.log(`    answer: ${result.answer.slice(0, 200)}`);
	console.log(`    confidence: ${result.confidence}`);
	console.log(`    frames: ${result.evidenceFrames.length}`);
	for (const f of result.evidenceFrames) {
		console.log(`      [${(f.t / 1000).toFixed(2)}s] ${f.caption.slice(0, 120)}`);
	}

	// Loose sanity check — model should have recognized it as a test/pattern video.
	const lower = result.answer.toLowerCase();
	const keywords = ["test", "pattern", "bar", "color", "synthetic", "grid"];
	if (keywords.some((k) => lower.includes(k))) {
		pass("answer references test-pattern keywords");
	} else {
		fail("answer does not mention expected test-pattern keywords", {
			answer: result.answer,
		});
	}
	if (result.evidenceFrames.length === 0) {
		fail("no evidence frames returned");
	}
} finally {
	await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

// ==================== Summary ====================

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nAll post-deploy checks passed ✓");

// Keep TS happy about unused imports when running under strict mode.
void writeFile;
