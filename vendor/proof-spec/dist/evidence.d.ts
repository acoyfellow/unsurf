/**
 * proof-spec.v0 — evidence types (the "what happened").
 *
 * Runtime result shapes returned by any runner. Stable across unsurf,
 * gateproof, trace, lab.
 */
import type { Assertion, DslOp, Observation } from "./spec.js";
export type Status = "pass" | "fail" | "inconclusive";
export interface ObservationResult {
    kind: Observation["kind"];
    ok: boolean;
    detail?: string | undefined;
    durationMs: number;
}
export interface ActionResult {
    op: DslOp["op"];
    ok: boolean;
    error?: string | undefined;
    readValue?: string | undefined;
    durationMs: number;
}
export interface AssertionResult {
    kind: Assertion["kind"];
    ok: boolean;
    detail?: string | undefined;
}
export interface EvidenceBundle {
    status: Status;
    iterations: number;
    observations: readonly ObservationResult[];
    actions: readonly ActionResult[];
    assertions: readonly AssertionResult[];
    /** MCP-shaped content (for invoke() usage). */
    content?: readonly {
        type: "text";
        text: string;
    }[] | undefined;
    errors: readonly string[];
}
//# sourceMappingURL=evidence.d.ts.map