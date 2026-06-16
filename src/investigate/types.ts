export type ReproStep =
	| { op: "goto"; url?: string }
	| { op: "click"; selector: string }
	| { op: "fill"; selector: string; value: string }
	| { op: "wait"; ms: number }
	| { op: "waitFor"; selector: string; timeoutMs?: number }
	| { op: "reload" }
	| { op: "snapshot"; label?: string }
	| { op: "assertState"; selector: string; attribute: string; equals: string };

export interface ReproSpec {
	version: 1;
	name: string;
	symptom: string;
	steps: ReproStep[];
	failureState: { selector: string; attribute: string; equals: string };
	successState?: { selector: string; attribute: string; equals: string };
}

export interface InvestigatorCandidate {
	investigator: string;
	hypothesis: string;
	steps: ReproStep[];
	observed: boolean;
	states: string[];
}

export interface ReplayReceipt {
	target: string;
	run: number;
	passed: boolean;
	failureObserved: boolean;
	states: string[];
	screenshot?: string;
	error?: string;
}

export interface InvestigationReceipt {
	version: 1;
	id: string;
	createdAt: string;
	provider: "cmux";
	discoveryMode: "agents" | "deterministic" | "repro-only";
	symptom: string;
	brokenUrl: string;
	fixedUrl?: string;
	isolation: "shared-profile";
	candidates: InvestigatorCandidate[];
	promoted?: ReproSpec;
	broken: ReplayReceipt[];
	fixed: ReplayReceipt[];
	passed: boolean;
}
