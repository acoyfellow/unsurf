// Run: UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/heal-measure.ts
export {};
declare const Bun: {
	write(path: string, data: string): Promise<number>;
	file(path: string): { json(): Promise<unknown> };
};

const UNSURF_URL = process.env.UNSURF_URL ?? "https://unsurf-api.coey.dev";
const DELAY_MS = 8000;
const SCOUT_TIMEOUT_MS = 90000;
const TOOL_TIMEOUT_MS = 60000;

const TARGETS = [
	{ url: "https://jsonplaceholder.typicode.com", task: "get fake JSON data" },
	{ url: "https://pokeapi.co", task: "get Pokemon data" },
	{ url: "https://catfact.ninja", task: "get cat facts" },
	{ url: "https://api.open-meteo.com", task: "get weather forecast" },
	{ url: "https://api.frankfurter.app", task: "get exchange rates" },
	{ url: "https://restcountries.com", task: "get country info" },
	{ url: "https://dog.ceo", task: "get dog images" },
	{ url: "https://icanhazdadjoke.com", task: "get dad jokes" },
	{ url: "https://api.dictionaryapi.dev", task: "get word definitions" },
	{ url: "https://httpbin.org", task: "test HTTP requests" },
];

// ==================== Types ====================

interface HealTestResult {
	url: string;
	task: string;
	siteId: string;
	pathId: string;
	scoutSuccess: boolean;
	scoutEndpoints: number;
	scoutDurationMs: number;
	scoutFromGallery: boolean;
	workerSuccess: boolean;
	workerError: string;
	workerDurationMs: number;
	healAttempted: boolean;
	healSuccess: boolean;
	healNewPathId: string;
	healDurationMs: number;
	healError: string;
	timestamp: string;
}

interface ToolResponse {
	ok: boolean;
	status: number;
	body: Record<string, unknown>;
}

// ==================== Helpers ====================

async function postTool(
	tool: string,
	payload: unknown,
	timeoutMs = TOOL_TIMEOUT_MS,
): Promise<ToolResponse> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${UNSURF_URL}/tools/${tool}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		clearTimeout(timeout);
		const body = await res.json();
		return { ok: res.ok, status: res.status, body: body as Record<string, unknown> };
	} catch (e) {
		clearTimeout(timeout);
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, status: 0, body: { error: msg } };
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function elapsed(startMs: number): number {
	return Date.now() - startMs;
}

// ==================== Main ====================

const results: HealTestResult[] = [];
const scoutedPaths: Array<{
	url: string;
	task: string;
	siteId: string;
	pathId: string;
	endpoints: number;
	fromGallery: boolean;
}> = [];

// ── Phase 1: Scout all targets ──────────────────────────────────────
console.log("=== Phase 1: Scouting %d targets ===\n", TARGETS.length);

for (const target of TARGETS) {
	const start = Date.now();
	const res = await postTool("scout", { url: target.url, task: target.task }, SCOUT_TIMEOUT_MS);
	const duration = elapsed(start);

	if (res.ok && res.body.pathId) {
		scoutedPaths.push({
			url: target.url,
			task: target.task,
			siteId: String(res.body.siteId ?? ""),
			pathId: String(res.body.pathId),
			endpoints: Number(res.body.endpointCount ?? 0),
			fromGallery: Boolean(res.body.fromGallery),
		});
		const tag = res.body.fromGallery ? " [gallery]" : "";
		console.log(
			`  \u2713 ${target.url} \u2014 ${res.body.endpointCount} endpoints${tag} (${(duration / 1000).toFixed(1)}s)`,
		);
	} else {
		console.log(
			`  \u2717 ${target.url} \u2014 ${res.body.error ?? `HTTP ${res.status}`} (${(duration / 1000).toFixed(1)}s)`,
		);
	}

	await delay(DELAY_MS);
}

console.log(`\nScouted: ${scoutedPaths.length} / ${TARGETS.length}\n`);

if (scoutedPaths.length === 0) {
	console.error("No sites scouted successfully. Cannot proceed with heal measurement.");
	process.exit(1);
}

// ── Phase 2: Test worker on each scouted path ──────────────────────
console.log("=== Phase 2: Testing worker on %d paths ===\n", scoutedPaths.length);

const workerResults = new Map<string, { success: boolean; error: string; durationMs: number }>();

for (const sp of scoutedPaths) {
	const start = Date.now();
	const res = await postTool("worker", { pathId: sp.pathId });
	const duration = elapsed(start);

	const success = res.ok && res.body.success === true;
	const error = success ? "" : String(res.body.error ?? res.body.response ?? `HTTP ${res.status}`);

	workerResults.set(sp.pathId, { success, error, durationMs: duration });

	console.log(
		`  ${success ? "\u2713" : "\u2717"} Worker ${sp.url} \u2014 ${success ? "ok" : error} (${(duration / 1000).toFixed(1)}s)`,
	);

	await delay(2000);
}

// ── Phase 3: Simulate breakage \u2192 call heal ────────────────────────
console.log("\n=== Phase 3: Testing heal on %d paths ===\n", scoutedPaths.length);

const SIM_ERRORS = [
	"Simulated: endpoint returned 500 Internal Server Error",
	"Simulated: endpoint returned 502 Bad Gateway",
	"Simulated: endpoint returned 404 Not Found - path may have changed",
	"Simulated: connection refused - service may be down",
	"Simulated: response was HTML instead of JSON",
	"Simulated: endpoint returned 403 Forbidden",
	"Simulated: request timed out after 30s",
	"Simulated: SSL certificate expired",
	"Simulated: unexpected EOF in response body",
	"Simulated: DNS resolution failed for host",
];

for (let i = 0; i < scoutedPaths.length; i++) {
	const sp = scoutedPaths[i] as (typeof scoutedPaths)[number];
	const wr = workerResults.get(sp.pathId) as {
		success: boolean;
		error: string;
		durationMs: number;
	};
	const simError = SIM_ERRORS[i % SIM_ERRORS.length] as string;

	const healStart = Date.now();
	const healRes = await postTool("heal", { pathId: sp.pathId, error: simError }, SCOUT_TIMEOUT_MS);
	const healDuration = elapsed(healStart);

	const healSuccess = healRes.ok && healRes.body.healed === true;
	const healNewPathId = String(healRes.body.newPathId ?? "");
	const healError = healSuccess
		? ""
		: String(healRes.body.error ?? `healed=${healRes.body.healed}`);

	const result: HealTestResult = {
		url: sp.url,
		task: sp.task,
		siteId: sp.siteId,
		pathId: sp.pathId,
		scoutSuccess: true,
		scoutEndpoints: sp.endpoints,
		scoutDurationMs: 0,
		scoutFromGallery: sp.fromGallery,
		workerSuccess: wr.success,
		workerError: wr.error,
		workerDurationMs: wr.durationMs,
		healAttempted: true,
		healSuccess,
		healNewPathId,
		healDurationMs: healDuration,
		healError,
		timestamp: new Date().toISOString(),
	};

	results.push(result);

	const icon = healSuccess ? "\u2713" : "\u2717";
	const newPath = healNewPathId ? ` \u2192 ${healNewPathId}` : "";
	console.log(
		`  ${icon} Heal ${sp.url} \u2014 ${healSuccess ? "healed" : "failed"} (${(healDuration / 1000).toFixed(1)}s)${newPath}${healError ? ` \u2014 ${healError}` : ""}`,
	);

	await delay(DELAY_MS);
}

// ── Write results JSON ──────────────────────────────────────────────
const output = {
	meta: {
		unsurfUrl: UNSURF_URL,
		targetsCount: TARGETS.length,
		scoutedCount: scoutedPaths.length,
		timestamp: new Date().toISOString(),
		delayMs: DELAY_MS,
	},
	results,
};

await Bun.write(".sisyphus/evidence/task-2-heal-results.json", JSON.stringify(output, null, 2));

// ── Generate report ─────────────────────────────────────────────────
const totalTargets = TARGETS.length;
const totalScouted = scoutedPaths.length;
const totalWorkerOk = results.filter((r) => r.workerSuccess).length;
const totalHealAttempted = results.filter((r) => r.healAttempted).length;
const totalHealSuccess = results.filter((r) => r.healSuccess).length;
const healRate =
	totalHealAttempted > 0 ? ((totalHealSuccess / totalHealAttempted) * 100).toFixed(1) : "0.0";
const avgHealTime =
	results.length > 0 ? results.reduce((sum, r) => sum + r.healDurationMs, 0) / results.length : 0;
const newPathCount = results.filter((r) => r.healNewPathId !== "").length;

const healFailures = results.filter((r) => !r.healSuccess);
const failurePatterns: Record<string, string[]> = {};
for (const f of healFailures) {
	const err = f.healError.toLowerCase();
	let cat = "unknown";
	if (err.includes("timeout") || err.includes("abort")) cat = "timeout";
	else if (err.includes("not found") || err.includes("notfound")) cat = "path_not_found";
	else if (err.includes("browser")) cat = "browser_error";
	else if (err.includes("store")) cat = "store_error";
	else if (err.includes("healed=false")) cat = "heal_returned_false";
	else if (err.includes("network")) cat = "network_error";

	const bucket = failurePatterns[cat] ?? [];
	bucket.push(f.url);
	failurePatterns[cat] = bucket;
}

const healedViaRetry = results.filter((r) => r.healSuccess && r.healNewPathId === "").length;
const healedViaRescout = results.filter((r) => r.healSuccess && r.healNewPathId !== "").length;

const report = `# Task 2: Heal Effectiveness Report

**Generated**: ${new Date().toISOString()}
**Target**: ${UNSURF_URL}

## Summary

| Metric | Value |
|--------|-------|
| Sites targeted | ${totalTargets} |
| Sites scouted successfully | ${totalScouted} (${((totalScouted / totalTargets) * 100).toFixed(1)}%) |
| Worker success (pre-heal) | ${totalWorkerOk} / ${totalScouted} |
| Heal attempts | ${totalHealAttempted} |
| **Heal successes** | **${totalHealSuccess} (${healRate}%)** |
| Heal failures | ${totalHealAttempted - totalHealSuccess} |
| Avg heal time | ${(avgHealTime / 1000).toFixed(1)}s |
| New paths created (re-scout) | ${newPathCount} |

## Heal Mechanism Breakdown

| Mechanism | Count | Description |
|-----------|-------|-------------|
| Retry success | ${healedViaRetry} | Worker succeeded on retry (transient error) |
| Re-scout success | ${healedViaRescout} | Heal re-scouted the URL and got a new working path |
| Failed | ${totalHealAttempted - totalHealSuccess} | Neither retry nor re-scout fixed the issue |

## Results by Site

| URL | Endpoints | Worker OK | Heal | New Path | Heal Time |
|-----|-----------|-----------|------|----------|-----------|
${results.map((r) => `| ${r.url} | ${r.scoutEndpoints} | ${r.workerSuccess ? "\u2713" : "\u2717"} | ${r.healSuccess ? "\u2713" : "\u2717"} | ${r.healNewPathId ? "yes" : "no"} | ${(r.healDurationMs / 1000).toFixed(1)}s |`).join("\n")}

## Failure Analysis

${
	healFailures.length === 0
		? "No heal failures recorded."
		: Object.entries(failurePatterns)
				.map(
					([cat, urls]) => `### ${cat} (${urls.length})\n${urls.map((u) => `- ${u}`).join("\n")}`,
				)
				.join("\n\n")
}

## Methodology

1. **Scout phase**: Each target URL was scouted via \`POST /tools/scout\` to capture API endpoints and obtain a pathId.
2. **Worker phase**: Each pathId was tested via \`POST /tools/worker\` to verify the path works before heal testing.
3. **Heal phase**: Each pathId was passed to \`POST /tools/heal\` with a simulated error message. Heal first retries the worker with exponential backoff (500ms, 1s, 2s \u00d7 2 retries). If retries fail, it re-scouts the original URL and creates a new path.

### Simulated Errors Used
${SIM_ERRORS.map((e) => `- ${e}`).join("\n")}

## Notes

- Heal first retries the worker with exponential backoff (500ms, 1s, 2s \u00d7 2 retries)
- If retries fail, heal re-scouts the URL and creates a new path
- "New Path" = heal had to re-scout (transient retry wasn't enough)
- Worker may succeed on retry if the original endpoint is still live, making heal report \`healed: true\` without needing a re-scout
- Gallery-cached sites may have stale endpoints that worker can't replay
`;

await Bun.write(".sisyphus/evidence/task-2-heal-report.md", report);

// ── Final summary ───────────────────────────────────────────────────
console.log(`\n${"=".repeat(60)}`);
console.log(
	`SCOUT RATE: ${totalScouted}/${totalTargets} = ${((totalScouted / totalTargets) * 100).toFixed(1)}%`,
);
console.log(
	`WORKER RATE: ${totalWorkerOk}/${totalScouted} = ${totalScouted > 0 ? ((totalWorkerOk / totalScouted) * 100).toFixed(1) : 0}%`,
);
console.log(`HEAL RATE: ${totalHealSuccess}/${totalHealAttempted} = ${healRate}%`);
console.log(`  - Via retry: ${healedViaRetry}`);
console.log(`  - Via re-scout: ${healedViaRescout}`);
console.log(`Avg heal time: ${(avgHealTime / 1000).toFixed(1)}s`);
console.log("=".repeat(60));
console.log("\nResults: .sisyphus/evidence/task-2-heal-results.json");
console.log("Report:  .sisyphus/evidence/task-2-heal-report.md");
