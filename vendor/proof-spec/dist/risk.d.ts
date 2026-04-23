/**
 * Deterministic risk labeler. Pure function, zero deps. Runners MUST call this
 * on every spec before running `act[]`. Synthesizers do not set risk.
 */
import type { DslOp, Risk } from "./spec.js";
export declare function computeRisk(act: readonly DslOp[] | undefined): Risk;
//# sourceMappingURL=risk.d.ts.map