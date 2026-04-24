#!/usr/bin/env bun
/**
 * Live loop() demo runnable from CI.
 *
 * Drives the full pipeline against httpbin's form:
 *
 *   record → observeVideo → met? → refine → record → …
 *
 * Prints a JSON summary at the end so the workflow can surface the
 * trace URLs and final answer in the step summary.
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN       Workers AI (planner/refiner + observe)
 *   CLOUDFLARE_ACCOUNT_ID
 *   TRACE_INGEST_TOKEN         to upload each iteration's bundle
 *   TRACE_INGEST_ENDPOINT      default https://trace.coey.dev
 */

import { loop } from "../src/skills/loop/index.js";

const northStar =
	"Did the user fill all three text fields (Customer name, Telephone, E-mail) " +
	"with non-empty values that look like a real name, phone, and email?";

const seedSpec = {
	url: "https://httpbin.org/forms/post",
	steps: [
		{ op: "waitFor" as const, selector: 'input[name="custname"]', timeoutMs: 15_000 },
		{ op: "fill" as const, selector: 'input[name="custname"]', value: "Jordan Coeyman" },
		{ op: "wait" as const, ms: 400 },
		{ op: "fill" as const, selector: 'input[name="custtel"]', value: "555-0100" },
		{ op: "wait" as const, ms: 400 },
		{ op: "fill" as const, selector: 'input[name="custemail"]', value: "jordan@example.com" },
		{ op: "wait" as const, ms: 1500 },
	],
};

const result = await loop({
	spec: seedSpec,
	northStar,
	maxIterations: 2,
	tickMs: 120_000,
	onTick: (t) => {
		const status = t.met ? "✓ met" : t.error ? `✗ error: ${t.error.slice(0, 80)}` : "· not-met";
		const conf = typeof t.confidence === "number" ? ` (conf=${t.confidence.toFixed(2)})` : "";
		// biome-ignore lint/suspicious/noConsole: this script's job is to log.
		console.log(`[loop] iteration ${t.iteration}: ${status}${conf} ${t.traceUrl ?? ""}`);
	},
});

// biome-ignore lint/suspicious/noConsole: script output is the point.
console.log(JSON.stringify(result, null, 2));
if (!result.met) process.exit(result.stopReason === "maxIterations" ? 2 : 1);
