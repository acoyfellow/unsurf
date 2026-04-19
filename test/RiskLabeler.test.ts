import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	computeRiskSync,
	makeRiskLabeler,
	type RiskDslOp,
	relabelSpecSync,
} from "../src/services/RiskLabeler.js";

const labeler = makeRiskLabeler();
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

describe("RiskLabeler", () => {
	describe("all-read → low", () => {
		it("single read op is low", () => {
			const r = computeRiskSync([{ op: "read", target: { role: "heading", name: "Title" } }]);
			expect(r.risk).toBe("low");
			expect(r.overrode).toBe(false);
		});

		it("multiple reads are still low", () => {
			const r = computeRiskSync([
				{ op: "read", target: { role: "heading", name: "Title" } },
				{ op: "read", target: { role: "textbox", name: "Email" } },
			]);
			expect(r.risk).toBe("low");
		});
	});

	describe("interactive without submit → medium", () => {
		it("single fill is medium", () => {
			const r = computeRiskSync([
				{ op: "fill", target: { role: "textbox", name: "Email" }, value: "x" },
			]);
			expect(r.risk).toBe("medium");
		});

		it("fill + click(benign) is medium", () => {
			const r = computeRiskSync([
				{ op: "fill", target: { role: "textbox", name: "Email" }, value: "x" },
				{ op: "click", target: { role: "button", name: "Next" } },
			]);
			expect(r.risk).toBe("medium");
		});

		it("check + select is medium", () => {
			const r = computeRiskSync([
				{ op: "check", target: { role: "checkbox", name: "Subscribe" }, value: true },
				{ op: "select", target: { role: "combobox", name: "Country" }, value: "US" },
			]);
			expect(r.risk).toBe("medium");
		});
	});

	describe("any submit → high", () => {
		it("bare submit is high", () => {
			const r = computeRiskSync([{ op: "submit", target: { role: "form", name: "Any" } }]);
			expect(r.risk).toBe("high");
		});

		it("fill + submit is high", () => {
			const r = computeRiskSync([
				{ op: "fill", target: { role: "textbox", name: "Email" }, value: "x" },
				{ op: "submit", target: { role: "form", name: "Signup" } },
			]);
			expect(r.risk).toBe("high");
		});
	});

	describe("destructive click → high", () => {
		const destructive: Array<[string, string]> = [
			["Delete account", "delete"],
			["Pay now", "pay"],
			["Buy", "buy"],
			["Send message", "send"],
			["Cancel subscription", "cancel"],
			["Remove from list", "remove"],
			["Confirm purchase", "confirm"],
			["Destroy workspace", "destroy"],
			["Wipe all data", "wipe"],
		];
		for (const [label, _verb] of destructive) {
			it(`"${label}" click is high`, () => {
				const r = computeRiskSync([{ op: "click", target: { role: "button", name: label } }]);
				expect(r.risk).toBe("high");
			});
		}
	});

	describe("word-boundary matching (no substring false-positives)", () => {
		it("'Cancellation policy' link is medium (not high)", () => {
			// "cancellation" is a different word from "cancel"; word-boundary regex respects this.
			const r = computeRiskSync([
				{ op: "click", target: { role: "link", name: "Cancellation policy" } },
			]);
			expect(r.risk).toBe("medium");
		});

		it("'Removed notices' link is medium (past tense of remove)", () => {
			const r = computeRiskSync([
				{ op: "click", target: { role: "link", name: "Removed notices" } },
			]);
			expect(r.risk).toBe("medium");
		});
	});

	describe("override detection (defeats the exp-008 attack surface)", () => {
		it("attacker claims low on submit → we compute high and flag override", () => {
			const r = computeRiskSync(
				[
					{ op: "fill", target: { role: "textbox", name: "Card" }, value: "x" },
					{ op: "submit", target: { role: "form", name: "Purchase" } },
				],
				"low",
			);
			expect(r.risk).toBe("high");
			expect(r.overrode).toBe(true);
			expect(r.originalClaim).toBe("low");
		});

		it("attacker claims low on destructive click → we compute high", () => {
			const r = computeRiskSync(
				[{ op: "click", target: { role: "button", name: "Delete Everything" } }],
				"low",
			);
			expect(r.risk).toBe("high");
			expect(r.overrode).toBe(true);
		});

		it("synth over-labels read-only as medium → we downgrade to low", () => {
			const r = computeRiskSync(
				[{ op: "read", target: { role: "heading", name: "Title" } }],
				"medium",
			);
			expect(r.risk).toBe("low");
			expect(r.overrode).toBe(true);
		});

		it("honest synth claim is preserved with overrode=false", () => {
			const r = computeRiskSync(
				[{ op: "read", target: { role: "heading", name: "Title" } }],
				"low",
			);
			expect(r.risk).toBe("low");
			expect(r.overrode).toBe(false);
		});
	});

	describe("relabelSpecSync: mutates tools in place", () => {
		it("relabels a multi-tool spec, logs overrides", () => {
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
						risk: "low" as const,
					},
					{
						name: "read_balance",
						dsl: [{ op: "read", target: { role: "heading", name: "Balance" } }],
						risk: "low" as const,
					},
				],
			};
			const summary = relabelSpecSync(spec);
			expect(spec.tools[0]?.risk).toBe("high");
			expect(spec.tools[1]?.risk).toBe("low");
			expect(summary.tools_relabeled).toBe(2);
			expect(summary.overrides).toHaveLength(1);
			expect(summary.overrides[0]?.tool_name).toBe("submit_payment");
			expect(summary.overrides[0]?.original_claim).toBe("low");
			expect(summary.overrides[0]?.computed).toBe("high");
		});

		it("no tools means no work", () => {
			const summary = relabelSpecSync({});
			expect(summary.tools_relabeled).toBe(0);
			expect(summary.overrides).toHaveLength(0);
		});

		it("empty tools array is handled", () => {
			const summary = relabelSpecSync({ tools: [] });
			expect(summary.tools_relabeled).toBe(0);
		});
	});

	describe("Effect service wrapper", () => {
		it("compute returns an Effect", async () => {
			const dsl: RiskDslOp[] = [{ op: "submit", target: { role: "form", name: "Any" } }];
			const result = await run(labeler.compute(dsl));
			expect(result.risk).toBe("high");
		});

		it("relabelSpec returns an Effect summary", async () => {
			const spec = {
				tools: [
					{
						name: "t",
						dsl: [{ op: "submit", target: { role: "form", name: "Any" } }],
						risk: "low" as const,
					},
				],
			};
			const summary = await run(labeler.relabelSpec(spec));
			expect(summary.tools_relabeled).toBe(1);
			expect(summary.overrides).toHaveLength(1);
			expect(spec.tools[0]?.risk).toBe("high");
		});
	});
});
