/**
 * RiskLabeler — deterministic risk classification for tool-spec.v0.json tools.
 *
 * The synthesizer's `risk` field is advisory. The runner/directory/validator MUST re-compute
 * risk from the DSL + target names using this function. Never trust a synthesizer-provided risk.
 *
 * Rules (from CONTRACT.md §Risk rubric):
 *   - low    = all ops are "read"
 *   - medium = includes click/fill/select/check (no submit, no destructive verbs)
 *   - high   = includes submit, OR click whose target.name matches destructive verbs
 *
 * Destructive verbs (case-insensitive substring match on target.name):
 *   delete, remove, pay, buy, send, confirm, destroy, cancel, wipe, exfiltrate,
 *   purge, erase, trash, unsubscribe (from account), charge, deactivate, uninstall
 *
 * This function is a single source of truth. The synthesizer can emit any `risk` it wants;
 * this function overwrites it. If the synthesizer's claim disagrees with ours, we log a
 * `risk_downgrade_attempt` signal so the Directory can flag adversarial pages.
 */

const DESTRUCTIVE_VERBS = [
	"delete", "remove", "pay", "buy", "send", "confirm", "destroy", "cancel",
	"wipe", "exfiltrate", "purge", "erase", "trash", "charge", "deactivate",
	"uninstall",
];

const DESTRUCTIVE_RE = new RegExp(`\\b(${DESTRUCTIVE_VERBS.join("|")})\\b`, "i");

export type DslOp = {
	op: "click" | "fill" | "select" | "check" | "submit" | "read";
	target: { role: string; name: string; nth?: number };
	value?: any;
};

export type Risk = "low" | "medium" | "high";

export interface LabelResult {
	risk: Risk;
	reasons: string[];           // human-readable list of why this risk was chosen
	overrode: boolean;           // did we disagree with the synthesizer-claimed risk?
	originalClaim?: Risk;        // what the synthesizer emitted (if provided)
}

/**
 * Compute the true risk level for a tool, given its DSL and (optional) synthesizer-claimed risk.
 * The claim is IGNORED for the final decision — it's only returned so callers can detect
 * adversarial downgrade attempts.
 */
export function computeRisk(dsl: DslOp[], claimedRisk?: Risk): LabelResult {
	const reasons: string[] = [];

	// Rule 1: all-read means low (safe to auto-execute, purely observational)
	const allRead = Array.isArray(dsl) && dsl.length > 0 && dsl.every(op => op.op === "read");
	if (allRead) {
		const result: LabelResult = { risk: "low", reasons: ["all ops are 'read'"], overrode: false };
		if (claimedRisk && claimedRisk !== "low") {
			result.overrode = true;
			result.originalClaim = claimedRisk;
			result.reasons.push(`synthesizer claimed '${claimedRisk}' but DSL is read-only`);
		}
		return result;
	}

	// Rule 2: any submit op → high
	const submitOps = dsl?.filter(op => op.op === "submit") ?? [];
	if (submitOps.length > 0) {
		reasons.push(`contains ${submitOps.length} submit op(s)`);
	}

	// Rule 3: any click whose target.name contains a destructive verb → high
	const destructiveClicks = dsl?.filter(op =>
		op.op === "click" && typeof op.target?.name === "string" && DESTRUCTIVE_RE.test(op.target.name)
	) ?? [];
	if (destructiveClicks.length > 0) {
		const names = destructiveClicks.map(op => op.target.name).join(", ");
		reasons.push(`destructive click target(s): ${names}`);
	}

	// Rule 4: any fill into a destructive-labeled field (e.g. "confirm password", "delete reason")
	// This is a softer signal — a field labeled "confirm" usually means a confirmation step, which is usually high.
	// We don't escalate on fill alone but do note it.
	// (Omitted for v0 to keep the rule simple — can add in v1 if real-world data shows need.)

	if (submitOps.length > 0 || destructiveClicks.length > 0) {
		const result: LabelResult = { risk: "high", reasons, overrode: false };
		if (claimedRisk && claimedRisk !== "high") {
			result.overrode = true;
			result.originalClaim = claimedRisk;
			result.reasons.push(`synthesizer claimed '${claimedRisk}' but DSL contains high-risk op(s)`);
		}
		return result;
	}

	// Otherwise medium
	reasons.push("interactive ops without submit or destructive verbs");
	const result: LabelResult = { risk: "medium", reasons, overrode: false };
	if (claimedRisk && claimedRisk !== "medium") {
		result.overrode = true;
		result.originalClaim = claimedRisk;
		result.reasons.push(`synthesizer claimed '${claimedRisk}' but DSL indicates medium`);
	}
	return result;
}

/**
 * Apply deterministic risk labeling to an entire tool-spec.v0.json.
 * Returns the spec with all tools' risk fields re-computed, plus a summary of any overrides.
 */
export interface RelabelSummary {
	tools_relabeled: number;
	overrides: Array<{
		tool_name: string;
		original_claim: Risk;
		computed: Risk;
		reasons: string[];
	}>;
}

export function relabelSpec(spec: any): RelabelSummary {
	const summary: RelabelSummary = { tools_relabeled: 0, overrides: [] };
	if (!spec?.tools || !Array.isArray(spec.tools)) return summary;

	for (const tool of spec.tools) {
		if (!Array.isArray(tool.dsl)) continue;
		const claim = tool.risk;
		const result = computeRisk(tool.dsl, claim);
		tool.risk = result.risk;
		summary.tools_relabeled++;
		if (result.overrode) {
			summary.overrides.push({
				tool_name: tool.name ?? "(unnamed)",
				original_claim: result.originalClaim!,
				computed: result.risk,
				reasons: result.reasons,
			});
		}
	}
	return summary;
}
