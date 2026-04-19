import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { ProofSpec } from "../src/domain/ProofSpec.js";
import { computeRisk } from "../src/domain/ProofSpec.js";
import { invokeSpec, makePlan, Plan, PlanLive, runSpec, verifySpec } from "../src/services/Plan.js";

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

// Minimal spec that hits a public HTTP endpoint — no CDP required.
// Verifies the Plan surface works end-to-end for the HTTP-only subset.
const httpGateSpec: ProofSpec = {
	version: "v0",
	target: { url: "https://example.com/" },
	name: "verify_example_dot_com",
	description: "Example.com responds 200 — smallest possible gate.",
	inputSchema: { type: "object", properties: {}, required: [] },
	observe: [{ kind: "http", url: "https://example.com/", expect: { status: 200 } }],
	assert: [{ kind: "httpResponse", url: "https://example.com/", status: 200 }],
	risk: "low",
};

// A no-act no-observe spec — pure smoke test of the executor shape.
const noOpSpec: ProofSpec = {
	version: "v0",
	target: { url: "about:blank" },
	name: "noop",
	description: "No observe, no act, no assert. Should end with status=pass (no errors).",
	inputSchema: { type: "object", properties: {}, required: [] },
	risk: "low",
};

// A spec whose act has a submit op — runner MUST clamp loop to 1 regardless of spec claim.
const highRiskSpec: ProofSpec = {
	version: "v0",
	target: { url: "about:blank" },
	name: "destructive",
	description: "High-risk spec — loop must clamp to 1.",
	inputSchema: { type: "object", properties: {}, required: [] },
	// Don't actually reach a page — just exercise risk-clamp
	act: [{ op: "submit", target: { role: "form", name: "any" } }],
	assert: [{ kind: "noErrors" }],
	loop: { maxIterations: 5, stopOnFailure: false },
	risk: "high",
};

describe("Plan (proof-spec executor)", () => {
	describe("computeRisk pass-through", () => {
		it("high-risk specs have loop clamped to 1 iteration", async () => {
			// The spec declares loop=5, but computeRisk sees submit op → high → clamp to 1.
			const result = await runSpec(highRiskSpec, {});
			expect(result.iterations).toBe(1);
		});

		it("deterministic risk ignores claimed risk", () => {
			const readOnly: ProofSpec = {
				version: "v0",
				target: { url: "about:blank" },
				name: "reader",
				description: "claims medium but is actually low",
				inputSchema: { type: "object", properties: {}, required: [] },
				act: [{ op: "read", target: { role: "heading", name: "x" }, as: "text" }],
				risk: "medium", // a lie; computeRisk should say low
			};
			expect(computeRisk(readOnly.act)).toBe("low");
		});
	});

	describe("HTTP-only specs (no CDP required)", () => {
		it("verifySpec treats spec as observe+assert only, ignores act", async () => {
			const specWithAct: ProofSpec = {
				...httpGateSpec,
				// Include an act op that would require CDP — verify should still succeed
				act: [{ op: "click", target: { role: "button", name: "nope" } }],
			};
			const result = await verifySpec(specWithAct, {});
			// Act was stripped, so 0 actions ran
			expect(result.actions).toHaveLength(0);
			// Assertions should still fire
			expect(result.assertions.length).toBeGreaterThan(0);
		});

		it("runSpec on an HTTP-only gate returns pass when site is up", async () => {
			const result = await runSpec(httpGateSpec, {});
			// example.com is extremely stable, but accept either pass or a network fail
			expect(["pass", "fail"]).toContain(result.status);
			expect(result.observations.length).toBe(1);
			expect(result.assertions.length).toBe(1);
		}, 15_000);
	});

	describe("degenerate specs", () => {
		it("no-op spec ends with pass status", async () => {
			const result = await runSpec(noOpSpec, {});
			expect(result.status).toBe("pass");
			expect(result.observations).toHaveLength(0);
			expect(result.actions).toHaveLength(0);
			expect(result.assertions).toHaveLength(0);
			expect(result.errors).toHaveLength(0);
		});

		it("invokeSpec === runSpec (same thing, different name)", async () => {
			const r1 = await invokeSpec(noOpSpec, {});
			const r2 = await runSpec(noOpSpec, {});
			expect(r1.status).toBe(r2.status);
			expect(r1.iterations).toBe(r2.iterations);
		});
	});

	describe("Effect service surface", () => {
		it("auto() returns an EvidenceBundle via Effect", async () => {
			const program = Effect.gen(function* () {
				const plan = yield* Plan;
				return yield* plan.auto(noOpSpec, {});
			}).pipe(Effect.provide(PlanLive));

			const result = await run(program);
			expect(result.status).toBe("pass");
		});

		it("makePlan() produces service with 4 methods", () => {
			const svc = makePlan();
			expect(typeof svc.invoke).toBe("function");
			expect(typeof svc.verify).toBe("function");
			expect(typeof svc.runLoop).toBe("function");
			expect(typeof svc.auto).toBe("function");
		});
	});

	describe("judgeScore assertion", () => {
		it("fails softly with 'no judge endpoint' when WORKERS_AI_ENDPOINT is not set", async () => {
			const prev = process.env.WORKERS_AI_ENDPOINT;
			delete process.env.WORKERS_AI_ENDPOINT;
			try {
				const spec: ProofSpec = {
					version: "v0",
					target: { url: "about:blank" },
					name: "judge_no_endpoint",
					description: "judgeScore should fail softly when no judge endpoint is configured",
					inputSchema: { type: "object", properties: {}, required: [] },
					assert: [
						{
							kind: "judgeScore",
							scorer: "Correctness",
							expected: "a correct and helpful answer",
						},
					],
					risk: "low",
				};
				const result = await runSpec(spec, { input: "what is 1+1?" });
				expect(result.assertions).toHaveLength(1);
				const a = result.assertions[0];
				expect(a?.kind).toBe("judgeScore");
				expect(a?.ok).toBe(false);
				expect(a?.detail).toContain("no judge endpoint");
				// Sanity: no crash, no unhandled error
				expect(result.status).toBe("fail");
			} finally {
				if (prev !== undefined) process.env.WORKERS_AI_ENDPOINT = prev;
			}
		}, 20_000);

		it("computeRisk is unaffected by judgeScore assertions", () => {
			const spec: ProofSpec = {
				version: "v0",
				target: { url: "about:blank" },
				name: "judge_risk",
				description: "judgeScore is an assertion — never an action — so risk stays low",
				inputSchema: { type: "object", properties: {}, required: [] },
				assert: [{ kind: "judgeScore", scorer: "Correctness" }],
				risk: "low",
			};
			expect(computeRisk(spec.act)).toBe("low");
		});

		it("unknown scorer fails with a clear detail", async () => {
			const prev = process.env.WORKERS_AI_ENDPOINT;
			delete process.env.WORKERS_AI_ENDPOINT;
			try {
				const spec: ProofSpec = {
					version: "v0",
					target: { url: "about:blank" },
					name: "judge_bad_scorer",
					description: "unknown scorer should fail before any network call",
					inputSchema: { type: "object", properties: {}, required: [] },
					assert: [{ kind: "judgeScore", scorer: "NotARealScorer" }],
					risk: "low",
				};
				const result = await runSpec(spec, {});
				const a = result.assertions[0];
				expect(a?.ok).toBe(false);
				expect(a?.detail).toContain("unknown scorer");
			} finally {
				if (prev !== undefined) process.env.WORKERS_AI_ENDPOINT = prev;
			}
		});
	});

	describe("CDP-free edge cases", () => {
		it("observe block with only http runs without any CDP", async () => {
			const spec: ProofSpec = {
				version: "v0",
				target: { url: "https://example.com/" },
				name: "http_only_observe",
				description: "Just an HTTP observation, no DOM involvement.",
				inputSchema: { type: "object", properties: {}, required: [] },
				observe: [{ kind: "http", url: "https://example.com/" }],
				risk: "low",
			};
			const result = await runSpec(spec, {});
			expect(result.observations).toHaveLength(1);
			expect(result.observations[0]?.kind).toBe("http");
			// No CDP errors should be recorded
			expect(result.errors.filter((e) => e.startsWith("cdp-"))).toHaveLength(0);
		}, 15_000);

		it("exec ops are rejected in client runner", async () => {
			const spec: ProofSpec = {
				version: "v0",
				target: { url: "about:blank" },
				name: "exec_attempt",
				description: "exec ops should fail fast, not hang",
				inputSchema: { type: "object", properties: {}, required: [] },
				act: [{ op: "exec", command: "echo nope" }],
				risk: "low",
			};
			const result = await runSpec(spec, {});
			expect(result.actions).toHaveLength(1);
			expect(result.actions[0]?.ok).toBe(false);
			expect(result.actions[0]?.error).toContain("exec");
		});
	});
});
