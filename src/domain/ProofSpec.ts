/**
 * proof-spec.v0.json — TypeScript types.
 *
 * **Shim.** The actual types live in `@acoyfellow/proof-spec` (extracted
 * 2026-04-21 per ROADMAP-2026-04-19.md step 4). This file re-exports them so
 * existing imports keep working. New code should import from the package
 * directly.
 *
 * What still lives in unsurf (not in the package):
 * - `ProofRunner` interface — runner-side concern
 * - Executor code — `src/services/Plan.ts`
 * - Scorer rubrics — `src/domain/JudgeScorers.ts`
 * - Workers AI defaults — `src/ai/*`
 */

export type {
	ActionResult,
	AriaRole,
	// Assertions
	Assertion,
	AssertionResult,
	DomObservation,
	// Actions
	DslOp,
	ElementExistsAssertion,
	ElementTarget,
	EvidenceBundle,
	ExecObservation,
	HasActionAssertion,
	HttpObservation,
	HttpResponseAssertion,
	JudgeScoreAssertion,
	// Misc
	Loop,
	NoErrorsAssertion,
	NoteObservation,
	NumericDeltaFromEnvAssertion,
	// Observations
	Observation,
	ObservationResult,
	// The spec
	ProofSpec,
	Provenance,
	ResponseBodyIncludesAssertion,
	Risk,
	// Runtime results
	Status,
	// Target + addressing
	Target,
	TextPresentAssertion,
	UrlMatchesAssertion,
} from "@acoyfellow/proof-spec";

export { computeRisk } from "@acoyfellow/proof-spec";

// ==================== Runner interface (unsurf-specific) ====================

import type { EvidenceBundle, ProofSpec } from "@acoyfellow/proof-spec";

/**
 * What runners (unsurf-daemon, unsurf-worker, gateproof) must implement to be
 * proof-spec-compatible. Each method is optional; implementers declare what
 * they support via the capabilities flag.
 *
 * Kept out of `@acoyfellow/proof-spec` because it's a runtime-side concern;
 * the package is types + one pure function only.
 */
export interface ProofRunner {
	readonly capabilities: ReadonlySet<"dom" | "http" | "exec">;

	invoke(spec: ProofSpec, args: Record<string, unknown>): Promise<EvidenceBundle>;
	verify(spec: ProofSpec, args?: Record<string, unknown>): Promise<EvidenceBundle>;
	runLoop(spec: ProofSpec, args: Record<string, unknown>): Promise<EvidenceBundle>;
}
