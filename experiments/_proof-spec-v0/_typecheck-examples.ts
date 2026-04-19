#!/usr/bin/env bun
/**
 * Compile-time proof that types.ts correctly describes every example in
 * examples/. Run with `bun run _typecheck-examples.ts` — if it prints "OK",
 * the types and the JSON agree.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { computeRisk, type ProofSpec } from "./types";

const exDir = resolve(import.meta.dir, "examples");
const files = readdirSync(exDir).filter((f) => f.endsWith(".json"));

let ok = true;
for (const file of files) {
	const spec = JSON.parse(readFileSync(resolve(exDir, file), "utf8")) as ProofSpec;

	// Required-field check
	if (spec.version !== "v0") {
		console.error(`✗ ${file}: version !== "v0"`);
		ok = false;
		continue;
	}
	if (!spec.target?.url) {
		console.error(`✗ ${file}: missing target.url`);
		ok = false;
		continue;
	}
	if (!spec.name || !spec.description) {
		console.error(`✗ ${file}: missing name or description`);
		ok = false;
		continue;
	}
	if (!spec.inputSchema || spec.inputSchema.type !== "object") {
		console.error(`✗ ${file}: inputSchema not {type:object}`);
		ok = false;
		continue;
	}

	// Risk honesty check — synthesizer claim must match computeRisk(act)
	const claimed = spec.risk;
	const computed = computeRisk(spec.act);
	if (claimed !== computed) {
		console.error(
			`✗ ${file}: risk mismatch — claimed="${claimed}" computed="${computed}"`,
		);
		ok = false;
		continue;
	}

	// Shape summary
	const modes: string[] = [];
	if (spec.act && spec.act.length > 0) modes.push("tool");
	if (spec.observe && spec.observe.length > 0 && spec.assert && spec.assert.length > 0) {
		modes.push("gate");
	}
	if (spec.loop && (spec.loop.maxIterations ?? 1) > 1) modes.push("loop");
	const modeStr = modes.length ? modes.join("+") : "empty";

	console.log(
		`✓ ${file} — ${modeStr} · ${spec.act?.length ?? 0} acts · ${spec.assert?.length ?? 0} asserts · risk=${computed}`,
	);
}

if (ok) console.log("\nOK — all examples valid against types.ts");
else process.exit(1);
