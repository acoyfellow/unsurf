/**
 * @acoyfellow/proof-spec — types + one pure function.
 *
 * Zero runtime dependencies. Used by unsurf, gateproof, trace (unsurf/skills/record),
 * and lab's result type.
 *
 * See the root README for the shared-shape rationale.
 */
export type { Target, AriaRole, ElementTarget, Observation, DomObservation, HttpObservation, ExecObservation, NoteObservation, DslOp, Assertion, TextPresentAssertion, UrlMatchesAssertion, ElementExistsAssertion, HttpResponseAssertion, ResponseBodyIncludesAssertion, NoErrorsAssertion, HasActionAssertion, NumericDeltaFromEnvAssertion, JudgeScoreAssertion, Loop, Risk, Provenance, ProofSpec, } from "./spec.js";
export type { Status, ObservationResult, ActionResult, AssertionResult, EvidenceBundle, } from "./evidence.js";
export { computeRisk } from "./risk.js";
//# sourceMappingURL=index.d.ts.map