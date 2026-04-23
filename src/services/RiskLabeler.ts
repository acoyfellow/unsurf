/**
 * RiskLabeler — deterministic risk classification for WebMCP tool-spec.v0.json tools.
 *
 * The synthesizer's `risk` field is advisory. Every consumer of a tool-spec.v0.json
 * (Directory on write, runner on invoke) MUST re-compute risk from the DSL + target
 * names via this service. Never trust a synthesizer-provided risk.
 *
 * Rules (from experiments/CONTRACT.md §Risk rubric):
 *   - low    = all ops are "read"
 *   - medium = includes click/fill/select/check (no submit, no destructive verbs)
 *   - high   = includes submit, OR click whose target.name matches destructive verbs
 *
 * Destructive verbs (case-insensitive, word-boundary match on target.name):
 *   delete, remove, pay, buy, send, confirm, destroy, cancel, wipe, exfiltrate,
 *   purge, erase, trash, charge, deactivate, uninstall
 *
 * If the synthesizer's claimed risk disagrees with ours, the `overrides` array
 * records the attempt — sites whose catalogs repeatedly produce overrides can be
 * flagged as adversarial by the Directory.
 *
 * Provenance: shipped from `experiments/_infra/risk-labeler/` after exp-008b
 * demonstrated 10/10 defense against the adversarial specs exp-008 captured.
 * Pure function. 29 unit tests in `test/RiskLabeler.test.ts`.
 */

import { Context, Effect, Layer } from "effect";

// ==================== Public types ====================

export type Risk = "low" | "medium" | "high";

export interface RiskDslOp {
	readonly op: "click" | "fill" | "select" | "check" | "submit" | "read";
	readonly target: { readonly role: string; readonly name: string; readonly nth?: number };
	readonly value?: unknown;
}

export interface LabelResult {
	readonly risk: Risk;
	readonly reasons: ReadonlyArray<string>;
	readonly overrode: boolean;
	readonly originalClaim?: Risk;
}

export interface Override {
	readonly tool_name: string;
	readonly original_claim: Risk;
	readonly computed: Risk;
	readonly reasons: ReadonlyArray<string>;
}

export interface RelabelSummary {
	readonly tools_relabeled: number;
	readonly overrides: ReadonlyArray<Override>;
}

// ==================== Service interface ====================

export interface RiskLabelerService {
	/** Compute the true risk for a tool's DSL, given an optional synthesizer-claimed risk. */
	readonly compute: (
		dsl: ReadonlyArray<RiskDslOp>,
		claimedRisk?: Risk,
	) => Effect.Effect<LabelResult>;

	/** Relabel every tool in a tool-spec.v0.json in place, returning a summary of overrides. */
	readonly relabelSpec: (spec: {
		tools?: Array<{ name?: string; dsl?: unknown; risk?: Risk }>;
	}) => Effect.Effect<RelabelSummary>;
}

export class RiskLabeler extends Context.Tag("RiskLabeler")<RiskLabeler, RiskLabelerService>() {}

// ==================== Implementation ====================

const DESTRUCTIVE_VERBS = [
	"delete",
	"remove",
	"pay",
	"buy",
	"send",
	"confirm",
	"destroy",
	"cancel",
	"wipe",
	"exfiltrate",
	"purge",
	"erase",
	"trash",
	"charge",
	"deactivate",
	"uninstall",
];

const DESTRUCTIVE_RE = new RegExp(`\\b(${DESTRUCTIVE_VERBS.join("|")})\\b`, "i");

/**
 * Pure computation. Exposed separately so non-Effect callers (scripts, tests, the
 * Directory's SQL write path) can use it without pulling in an Effect runtime.
 */
export function computeRiskSync(dsl: ReadonlyArray<RiskDslOp>, claimedRisk?: Risk): LabelResult {
	const reasons: string[] = [];

	// Rule 1: all-read → low
	const allRead = Array.isArray(dsl) && dsl.length > 0 && dsl.every((op) => op.op === "read");
	if (allRead) {
		if (claimedRisk && claimedRisk !== "low") {
			return {
				risk: "low",
				reasons: [
					"all ops are 'read'",
					`synthesizer claimed '${claimedRisk}' but DSL is read-only`,
				],
				overrode: true,
				originalClaim: claimedRisk,
			};
		}
		return { risk: "low", reasons: ["all ops are 'read'"], overrode: false };
	}

	// Rule 2: any submit → high
	const submitCount = dsl.filter((op) => op.op === "submit").length;
	if (submitCount > 0) reasons.push(`contains ${submitCount} submit op(s)`);

	// Rule 3: destructive click → high
	const destructiveClicks = dsl.filter(
		(op) =>
			op.op === "click" &&
			typeof op.target?.name === "string" &&
			DESTRUCTIVE_RE.test(op.target.name),
	);
	if (destructiveClicks.length > 0) {
		const names = destructiveClicks.map((op) => op.target.name).join(", ");
		reasons.push(`destructive click target(s): ${names}`);
	}

	if (submitCount > 0 || destructiveClicks.length > 0) {
		if (claimedRisk && claimedRisk !== "high") {
			return {
				risk: "high",
				reasons: [
					...reasons,
					`synthesizer claimed '${claimedRisk}' but DSL contains high-risk op(s)`,
				],
				overrode: true,
				originalClaim: claimedRisk,
			};
		}
		return { risk: "high", reasons, overrode: false };
	}

	// Otherwise medium
	const mediumReasons = ["interactive ops without submit or destructive verbs"];
	if (claimedRisk && claimedRisk !== "medium") {
		return {
			risk: "medium",
			reasons: [...mediumReasons, `synthesizer claimed '${claimedRisk}' but DSL indicates medium`],
			overrode: true,
			originalClaim: claimedRisk,
		};
	}
	return { risk: "medium", reasons: mediumReasons, overrode: false };
}

/**
 * Relabel every tool in a tool-spec.v0.json shape in place. Returns a summary of
 * the overrides so callers (Directory, logging) can track adversarial patterns.
 *
 * Mutates `spec.tools[].risk`. Does not touch any other field.
 */
export function relabelSpecSync(spec: {
	tools?: Array<{ name?: string; dsl?: unknown; risk?: Risk }>;
}): RelabelSummary {
	const overrides: Override[] = [];
	let count = 0;

	if (!spec || !Array.isArray(spec.tools)) {
		return { tools_relabeled: 0, overrides: [] };
	}

	for (const tool of spec.tools) {
		if (!Array.isArray(tool.dsl)) continue;
		const claim = tool.risk;
		const result = computeRiskSync(tool.dsl as ReadonlyArray<RiskDslOp>, claim);
		tool.risk = result.risk;
		count++;
		if (result.overrode && result.originalClaim) {
			overrides.push({
				tool_name: tool.name ?? "(unnamed)",
				original_claim: result.originalClaim,
				computed: result.risk,
				reasons: result.reasons,
			});
		}
	}

	return { tools_relabeled: count, overrides };
}

// ==================== Service factory ====================

export function makeRiskLabeler(): RiskLabelerService {
	return {
		compute: (dsl, claimedRisk) => Effect.succeed(computeRiskSync(dsl, claimedRisk)),
		relabelSpec: (spec) => Effect.succeed(relabelSpecSync(spec)),
	};
}

export const RiskLabelerLive = Layer.succeed(RiskLabeler, makeRiskLabeler());
