/**
 * proof-spec.v0 — spec types (the "what").
 *
 * The schema every observe/act/assert runner consumes. Frozen at v0.
 *
 * See ./evidence.ts for runtime result shapes.
 * See ./risk.ts for the deterministic risk labeler.
 */
export interface Target {
    /** Canonical URL the spec applies to. */
    url: string;
    /** `sha256:...` content-addressed identity. */
    fingerprint?: string;
    /** Identifier for how the fingerprint was computed, e.g. `url+ax-role-name-v1`. */
    fingerprintStrategy?: string;
}
export type AriaRole = "button" | "textbox" | "combobox" | "searchbox" | "link" | "checkbox" | "radio" | "heading" | "img" | "list" | "listitem" | "table" | "cell" | "form" | "region" | "dialog" | "tab" | "tabpanel" | "navigation" | "status" | "option" | "menu" | "menuitem" | "switch" | "tooltip";
export interface ElementTarget {
    role: AriaRole;
    /** Accessible name — aria-label, associated label, or visible text. */
    name: string;
    /** 0-indexed among matches of (role, name). */
    nth?: number;
}
export type Observation = DomObservation | HttpObservation | ExecObservation | NoteObservation;
export interface DomObservation {
    kind: "dom";
    target: ElementTarget;
    /** What to read. Default "exists". */
    as?: "exists" | "text" | "value";
}
export interface HttpObservation {
    kind: "http";
    url: string;
    expect?: {
        status?: number;
        bodyIncludes?: string;
    };
}
export interface ExecObservation {
    kind: "exec";
    command: string;
    expect?: {
        exitCode?: number;
        stdoutIncludes?: string;
    };
}
export interface NoteObservation {
    kind: "note";
    source: string;
    field: string;
}
export type DslOp = {
    op: "click";
    target: ElementTarget;
} | {
    op: "fill";
    target: ElementTarget;
    value: string;
} | {
    op: "select";
    target: ElementTarget;
    value: string;
} | {
    op: "check";
    target: ElementTarget;
    value: boolean;
} | {
    op: "submit";
    target: ElementTarget;
} | {
    op: "read";
    target: ElementTarget;
    as: "text" | "value" | "attr";
    attr?: string;
} | {
    op: "exec";
    command: string;
    timeoutMs?: number;
};
export type Assertion = TextPresentAssertion | UrlMatchesAssertion | ElementExistsAssertion | HttpResponseAssertion | ResponseBodyIncludesAssertion | NoErrorsAssertion | HasActionAssertion | NumericDeltaFromEnvAssertion | JudgeScoreAssertion;
export interface TextPresentAssertion {
    kind: "textPresent";
    /** Case-insensitive substring match in visible page text. */
    value: string;
}
export interface UrlMatchesAssertion {
    kind: "urlMatches";
    /** Regex source (no slashes, no flags). */
    pattern: string;
}
export interface ElementExistsAssertion {
    kind: "elementExists";
    target: ElementTarget;
}
export interface HttpResponseAssertion {
    kind: "httpResponse";
    url?: string;
    status?: number;
    durationUnder?: number;
}
export interface ResponseBodyIncludesAssertion {
    kind: "responseBodyIncludes";
    value: string;
}
export interface NoErrorsAssertion {
    kind: "noErrors";
}
export interface HasActionAssertion {
    kind: "hasAction";
    id: string;
}
export interface NumericDeltaFromEnvAssertion {
    kind: "numericDeltaFromEnv";
    key: string;
    threshold: number;
}
/**
 * LLM-as-judge assertion. Scorer references a rubric (caller-defined; unsurf
 * ships `JudgeScorers.SCORERS` for the common set). At runtime, the output is
 * sent to a judge model which returns a score; assertion passes when
 * `score >= threshold` (default 1).
 *
 * Defaults are runner-specific. Unsurf defaults to Workers AI llama-3.3-70b.
 */
export interface JudgeScoreAssertion {
    kind: "judgeScore";
    /** Scorer name — caller decides the registry. */
    scorer: string;
    /** Expected behavior/answer, included in the judge prompt. */
    expected?: string | undefined;
    /** Minimum score to pass. Default 1. */
    threshold?: number | undefined;
    /** Judge model. Runner-specific default. */
    judgeModel?: string | undefined;
}
export interface Loop {
    /** Max number of iterations. Default 1. */
    maxIterations?: number;
    /** Stop immediately on an assertion failure. Default: true if maxIterations=1, else false. */
    stopOnFailure?: boolean;
    budget?: {
        timeMs?: number;
        tokens?: number;
    };
}
export type Risk = "low" | "medium" | "high";
export interface Provenance {
    synthesizedAt?: string;
    synthesizer?: {
        name: string;
        model?: string;
        promptHash?: string;
    };
    author?: {
        name: string;
        email?: string;
    };
}
export interface ProofSpec {
    version: "v0";
    target: Target;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: readonly string[];
    };
    observe?: readonly Observation[];
    act?: readonly DslOp[];
    assert?: readonly Assertion[];
    loop?: Loop;
    risk: Risk;
    provenance?: Provenance;
}
//# sourceMappingURL=spec.d.ts.map