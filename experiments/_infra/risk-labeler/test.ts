#!/usr/bin/env bun
/**
 * Unit tests for risk-labeler. No framework — just assertions.
 */

import { computeRisk, relabelSpec } from "./risk-labeler";

let pass = 0, fail = 0;
function eq(actual: any, expected: any, label: string) {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a === e) { pass++; console.log(`  ✓ ${label}`); }
	else { fail++; console.log(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`); }
}
function has(actual: string[], needle: string, label: string) {
	if (actual.some(s => s.includes(needle))) { pass++; console.log(`  ✓ ${label}`); }
	else { fail++; console.log(`  ✗ ${label} — reasons: ${JSON.stringify(actual)}`); }
}

console.log("== all-read → low");
eq(computeRisk([{ op: "read", target: { role: "heading", name: "Title" } }]).risk, "low", "single read → low");
eq(computeRisk([
	{ op: "read", target: { role: "heading", name: "Title" } },
	{ op: "read", target: { role: "textbox", name: "Email" } },
]).risk, "low", "two reads → low");

console.log("\n== interactive without submit → medium");
eq(computeRisk([{ op: "fill", target: { role: "textbox", name: "Email" }, value: "x" }]).risk, "medium", "single fill → medium");
eq(computeRisk([
	{ op: "fill", target: { role: "textbox", name: "Email" }, value: "x" },
	{ op: "click", target: { role: "button", name: "Next" } },
]).risk, "medium", "fill + click(benign) → medium");

console.log("\n== any submit → high");
eq(computeRisk([
	{ op: "fill", target: { role: "textbox", name: "Email" }, value: "x" },
	{ op: "submit", target: { role: "form", name: "Signup" } },
]).risk, "high", "fill + submit → high");
eq(computeRisk([{ op: "submit", target: { role: "form", name: "any" } }]).risk, "high", "bare submit → high");

console.log("\n== destructive click → high");
eq(computeRisk([{ op: "click", target: { role: "button", name: "Delete account" } }]).risk, "high", "Delete account → high");
eq(computeRisk([{ op: "click", target: { role: "button", name: "Pay now" } }]).risk, "high", "Pay now → high");
eq(computeRisk([{ op: "click", target: { role: "button", name: "Buy" } }]).risk, "high", "Buy → high");
eq(computeRisk([{ op: "click", target: { role: "button", name: "Send message" } }]).risk, "high", "Send message → high");

console.log("\n== word-boundary matching (not substring)");
// Word-boundary regex means "Cancellation policy" does NOT trigger on "cancel"
// because "cancellation" is a different word. "Cancel subscription" DOES trigger.
eq(computeRisk([{ op: "click", target: { role: "link", name: "Cancellation policy" } }]).risk, "medium", "Cancellation (policy link) → medium (not a standalone destructive verb)");
eq(computeRisk([{ op: "click", target: { role: "button", name: "Cancel subscription" } }]).risk, "high", "Cancel subscription → high (standalone word)");
eq(computeRisk([{ op: "click", target: { role: "button", name: "Remove from list" } }]).risk, "high", "Remove from list → high");
eq(computeRisk([{ op: "click", target: { role: "link", name: "Removed notices" } }]).risk, "medium", "Removed (adjective) → medium (word-boundary skips this)");

console.log("\n== override detection (the exp-008 attack surface)");
// Attacker claims risk=low on a submit op — we override to high
{
	const r = computeRisk(
		[
			{ op: "fill", target: { role: "textbox", name: "Card" }, value: "x" },
			{ op: "submit", target: { role: "form", name: "Purchase" } },
		],
		"low"
	);
	eq(r.risk, "high", "attacker claimed low on submit → we compute high");
	eq(r.overrode, true, "override flag set");
	eq(r.originalClaim, "low", "original claim preserved");
	has(r.reasons, "submit op", "reason mentions submit");
}

// Attacker claims risk=low on destructive click — we override
{
	const r = computeRisk(
		[{ op: "click", target: { role: "button", name: "Delete Everything" } }],
		"low"
	);
	eq(r.risk, "high", "attacker claimed low on destructive click → we compute high");
	eq(r.overrode, true, "override flag set");
}

// Synthesizer labels a read-only correctly as low — no override
{
	const r = computeRisk([{ op: "read", target: { role: "heading", name: "Title" } }], "low");
	eq(r.risk, "low", "honest low → stays low");
	eq(r.overrode, false, "no override needed");
}

// Synthesizer labels a read-only as medium — we DOWNGRADE to low (honest)
{
	const r = computeRisk([{ op: "read", target: { role: "heading", name: "Title" } }], "medium");
	eq(r.risk, "low", "synth over-labeled read-only → we downgrade to low");
	eq(r.overrode, true, "override flag set even on downgrade");
}

console.log("\n== relabelSpec: end-to-end on a multi-tool spec");
{
	const spec = {
		version: "v0",
		url: "https://test.example/",
		tools: [
			{
				name: "submit_payment",
				dsl: [
					{ op: "fill", target: { role: "textbox", name: "Card" }, value: "{{card}}" },
					{ op: "submit", target: { role: "form", name: "Pay" } },
				],
				risk: "low", // attacker-claimed
			},
			{
				name: "read_balance",
				dsl: [{ op: "read", target: { role: "heading", name: "Balance" } }],
				risk: "low",
			},
		],
	};
	const summary = relabelSpec(spec);
	eq(spec.tools[0].risk, "high", "submit_payment relabeled high");
	eq(spec.tools[1].risk, "low", "read_balance stays low");
	eq(summary.tools_relabeled, 2, "2 tools relabeled");
	eq(summary.overrides.length, 1, "1 override (submit_payment)");
	eq(summary.overrides[0].tool_name, "submit_payment", "override points at submit_payment");
}

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
if (fail > 0) process.exit(1);
