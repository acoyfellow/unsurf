/**
 * Form-fill demo for `unsurf record`.
 *
 * Phase 0 E2E proof: verifies the current `record()` skill produces a clean
 * mp4 of a multi-step form-fill tour. Uses httpbin.org/forms/post — a stable
 * public form playground, safe to hit repeatedly.
 *
 * Flow:
 *   1. goto https://httpbin.org/forms/post
 *   2. fill customer name
 *   3. fill phone
 *   4. fill email
 *   5. wait + snapshot so the video has a clear "filled" frame at the end
 *
 * Run:
 *   export TRACE_INGEST_TOKEN=...
 *   bun examples/form-fill-demo.ts
 *
 * Or via the CLI once dist/ is built:
 *   unsurf record ./examples/form-fill-demo.ts --task "fill httpbin form"
 */

import { recordLocal } from "../src/skills/record/index.js";
import type { BrowserHandle } from "../src/skills/record/types.js";

export default async function run(
	browser: BrowserHandle,
): Promise<{ filledName: string; filledEmail: string }> {
	await browser.goto("https://httpbin.org/forms/post");
	await browser.wait({ selector: 'input[name="custname"]', timeoutMs: 10_000 });

	const name = "Jordan Coeyman";
	const phone = "555-0100";
	const email = "jordan@example.com";

	await browser.fill('input[name="custname"]', name);
	await browser.wait(400);
	await browser.fill('input[name="custtel"]', phone);
	await browser.wait(400);
	await browser.fill('input[name="custemail"]', email);
	await browser.wait(600);

	// Hold the final frame so the mp4 has a clear "form filled" ending.
	await browser.wait(1200);
	return { filledName: name, filledEmail: email };
}

// Allow `bun examples/form-fill-demo.ts` direct execution.
if (import.meta.main) {
	const result = await recordLocal({
		task: "fill httpbin form with name/phone/email",
		run,
		harness: "form-fill-demo",
	});
	// biome-ignore lint/suspicious/noConsole: CLI output is the point.
	console.log(JSON.stringify(result, null, 2));
	if (result.status === "failed") process.exit(1);
}
