/**
 * proof-spec.v0.json — TypeScript types.
 *
 * The unified schema for observe/act/assert loops. A spec describes:
 *   - a tool    (act only, unsurf-shape)
 *   - a gate    (observe + assert, gateproof-shape)
 *   - a proof   (all three, with optional loop)
 *
 * Executor: src/services/Plan.ts (Effect-wrapped).
 * Design doc + examples: experiments/_proof-spec-v0/.
 * Rationale: ../../.context/THESIS-MERGE-UNSURF-GATEPROOF.md (local context).
 *
 * No runtime dependencies. Pure types + deterministic computeRisk().
 */

// ==================== Target ====================

export interface Target {
	/** Canonical URL the spec applies to. */
	url: string;
	/** `sha256:...` content-addressed identity. */
	fingerprint?: string;
	/** Identifier for how the fingerprint was computed, e.g. `url+ax-role-name-v1`. */
	fingerprintStrategy?: string;
}

// ==================== Role-based element addressing (DOM) ====================

export type AriaRole =
	| "button"
	| "textbox"
	| "combobox"
	| "searchbox"
	| "link"
	| "checkbox"
	| "radio"
	| "heading"
	| "img"
	| "list"
	| "listitem"
	| "table"
	| "cell"
	| "form"
	| "region"
	| "dialog"
	| "tab"
	| "tabpanel"
	| "navigation"
	| "status"
	| "option"
	| "menu"
	| "menuitem"
	| "switch"
	| "tooltip";

export interface ElementTarget {
	role: AriaRole;
	/** Accessible name — aria-label, associated label, or visible text. */
	name: string;
	/** 0-indexed among matches of (role, name). */
	nth?: number;
}

// ==================== Observe ====================

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

// ==================== Act ====================

export type DslOp =
	| { op: "click"; target: ElementTarget }
	| { op: "fill"; target: ElementTarget; value: string }
	| { op: "select"; target: ElementTarget; value: string }
	| { op: "check"; target: ElementTarget; value: boolean }
	| { op: "submit"; target: ElementTarget }
	| { op: "read"; target: ElementTarget; as: "text" | "value" | "attr"; attr?: string }
	| { op: "exec"; command: string; timeoutMs?: number };

// ==================== Assert ====================

export type Assertion =
	| TextPresentAssertion
	| UrlMatchesAssertion
	| ElementExistsAssertion
	| HttpResponseAssertion
	| ResponseBodyIncludesAssertion
	| NoErrorsAssertion
	| HasActionAssertion
	| NumericDeltaFromEnvAssertion
	| JudgeScoreAssertion;

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
 * LLM-as-judge assertion. Scorer references a rubric in `JudgeScorers.SCORERS`
 * (copied verbatim from cloudeval). At runtime, the spec output is sent to a
 * Workers AI judge model which returns A/B/C → 1/0.5/0. Assertion passes when
 * score >= threshold (default 1).
 *
 * Defaults: threshold=1, judgeModel="@cf/meta/llama-3.3-70b-instruct-fp8-fast".
 * Endpoint is resolved from the WORKERS_AI_ENDPOINT env var at runtime; if
 * missing/unreachable, the assertion fails softly with an informative detail.
 */
export interface JudgeScoreAssertion {
	kind: "judgeScore";
	/** Scorer name — keyof typeof SCORERS, e.g. "Correctness". */
	scorer: string;
	/** Expected behavior/answer, included in the judge prompt. */
	expected?: string | undefined;
	/** Minimum score to pass. Default 1. */
	threshold?: number | undefined;
	/** Workers AI judge model. Default "@cf/meta/llama-3.3-70b-instruct-fp8-fast". */
	judgeModel?: string | undefined;
}

// ==================== Loop ====================

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

// ==================== Risk ====================

export type Risk = "low" | "medium" | "high";

// ==================== Provenance ====================

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

// ==================== The Spec ====================

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

// ==================== Runtime result types ====================

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
	content?: readonly { type: "text"; text: string }[] | undefined;
	errors: readonly string[];
}

// ==================== Runner interface ====================

/**
 * What runners (unsurf-daemon, unsurf-worker, gateproof) must implement to be
 * proof-spec-compatible. Each method is optional; implementers declare what they
 * support via the capabilities flag.
 */
export interface ProofRunner {
	readonly capabilities: ReadonlySet<"dom" | "http" | "exec">;

	invoke(spec: ProofSpec, args: Record<string, unknown>): Promise<EvidenceBundle>;
	verify(spec: ProofSpec, args?: Record<string, unknown>): Promise<EvidenceBundle>;
	runLoop(spec: ProofSpec, args: Record<string, unknown>): Promise<EvidenceBundle>;
}

// ==================== Deterministic risk labeler (shared) ====================

/**
 * Re-implementation of src/services/RiskLabeler.ts's computeRisk, typed against
 * proof-spec's DslOp. Runners MUST call this on every spec before running act[].
 */
const DESTRUCTIVE_RE =
	/\b(delete|remove|pay|buy|send|confirm|destroy|cancel|wipe|exfiltrate|purge|erase|trash|charge|deactivate|uninstall)\b/i;

export function computeRisk(act: readonly DslOp[] | undefined): Risk {
	if (!act || act.length === 0) return "low";
	if (act.every((op) => op.op === "read")) return "low";
	for (const op of act) {
		if (op.op === "submit") return "high";
		if (op.op === "click" && DESTRUCTIVE_RE.test(op.target.name)) return "high";
	}
	return "medium";
}
