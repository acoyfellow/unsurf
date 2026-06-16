import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openCmuxBrowser, type CmuxBrowserHandle } from "../../src/skills/record/index.js";

const ROOT = new URL(".", import.meta.url).pathname;
const OUT = path.join(ROOT, "out");
const EVIDENCE = path.join(OUT, "evidence");
const FIXTURE_PORT = Number(process.env.EXP014_PORT ?? 4178);
const BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const RUNS = 3;
const SYMPTOM = "The response looked complete, but then it continued unexpectedly.";
const STRATEGY_NAMES = ["timing-observer", "lifecycle-recovery", "repeated-interaction", "skeptical-free-explorer"] as const;

interface Step {
	op: "goto" | "click" | "wait" | "reload" | "snapshot";
	selector?: string;
	ms?: number;
	label?: string;
}

interface Candidate {
	investigator: string;
	hypothesis: string;
	status: "candidate" | "not-found";
	steps: Step[];
}

interface ReplayResult {
	target: "broken" | "fixed";
	run: number;
	reproduced: boolean;
	completionObserved: boolean;
	stableCompletionObserved: boolean;
	states: string[];
	screenshot: string;
}

const deterministicCandidates: Candidate[] = [
	{
		investigator: "timing-observer",
		hypothesis: "A delayed continuation may arrive after the interface first becomes complete.",
		status: "candidate",
		steps: [
			{ op: "goto" },
			{ op: "click", selector: "#start" },
			{ op: "wait", ms: 900 },
			{ op: "snapshot", label: "apparently-complete" },
			{ op: "wait", ms: 2600 },
			{ op: "snapshot", label: "later-state" },
		],
	},
	{
		investigator: "lifecycle-recovery",
		hypothesis: "Refreshing shortly after apparent completion may expose a pending continuation.",
		status: "candidate",
		steps: [
			{ op: "goto" },
			{ op: "click", selector: "#start" },
			{ op: "wait", ms: 900 },
			{ op: "snapshot", label: "apparently-complete" },
			{ op: "reload" },
			{ op: "wait", ms: 2600 },
			{ op: "snapshot", label: "later-state" },
		],
	},
	{
		investigator: "repeated-interaction",
		hypothesis: "Starting a second response may reveal stale completion state.",
		status: "candidate",
		steps: [
			{ op: "goto" },
			{ op: "click", selector: "#start" },
			{ op: "wait", ms: 900 },
			{ op: "click", selector: "#new" },
			{ op: "click", selector: "#start" },
			{ op: "wait", ms: 2600 },
			{ op: "snapshot", label: "later-state" },
		],
	},
	{
		investigator: "skeptical-free-explorer",
		hypothesis: "The report may be false under a normal completion path.",
		status: "candidate",
		steps: [
			{ op: "goto" },
			{ op: "click", selector: "#start" },
			{ op: "wait", ms: 900 },
			{ op: "snapshot", label: "apparently-complete" },
			{ op: "wait", ms: 400 },
			{ op: "snapshot", label: "short-horizon" },
		],
	},
];

const STEP_SCHEMA = {
	type: "object",
	properties: {
		investigator: { type: "string", enum: [...STRATEGY_NAMES] },
		hypothesis: { type: "string" },
		steps: {
			type: "array",
			minItems: 3,
			maxItems: 10,
			items: {
				oneOf: [
					{ type: "object", properties: { op: { const: "goto" } }, required: ["op"], additionalProperties: false },
					{ type: "object", properties: { op: { const: "click" }, selector: { type: "string", enum: ["#start", "#new"] } }, required: ["op", "selector"], additionalProperties: false },
					{ type: "object", properties: { op: { const: "wait" }, ms: { type: "number", minimum: 100, maximum: 4000 } }, required: ["op", "ms"], additionalProperties: false },
					{ type: "object", properties: { op: { const: "reload" } }, required: ["op"], additionalProperties: false },
					{ type: "object", properties: { op: { const: "snapshot" }, label: { type: "string" } }, required: ["op", "label"], additionalProperties: false },
				],
			},
		},
	},
	required: ["investigator", "hypothesis", "steps"],
	additionalProperties: false,
} as const;

function extractWorkersAiText(data: Record<string, any>): string {
	const result = data.result ?? {};
	return result.response ?? result.choices?.[0]?.message?.content ?? "";
}

async function generateCandidate(investigator: (typeof STRATEGY_NAMES)[number]): Promise<Candidate> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!accountId || !token) die("--agents requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
	const prompt = [
		"You are one independent browser bug investigator.",
		`ROLE: ${investigator}`,
		`VAGUE SYMPTOM: ${SYMPTOM}`,
		`TARGET: ${BASE}/broken`,
		"The page has Start response and New response buttons. Explore causal timing and lifecycle hypotheses.",
		"Produce one minimal experiment. Start with goto. Include snapshots before and after the suspected transition.",
		"You may click only #start or #new, wait up to 4000ms, reload, and snapshot.",
		"Do not assume the implementation or mention broken/fixed variants.",
	].join("\n");
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/moonshotai/kimi-k2.6`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: 1400, temperature: 0.8, response_format: { type: "json_schema", json_schema: STEP_SCHEMA } }),
	});
	if (!response.ok) throw new Error(`Workers AI ${response.status}: ${(await response.text()).slice(0, 300)}`);
	const raw = JSON.parse(extractWorkersAiText(await response.json())) as Omit<Candidate, "status">;
	if (raw.investigator !== investigator) raw.investigator = investigator;
	return { ...raw, status: "candidate" };
}

async function candidateSet(): Promise<{ mode: "agents" | "deterministic"; candidates: Candidate[] }> {
	if (!process.argv.includes("--agents")) return { mode: "deterministic", candidates: deterministicCandidates };
	console.log("Generating four independent strategies with Workers AI…");
	return { mode: "agents", candidates: await Promise.all(STRATEGY_NAMES.map(generateCandidate)) };
}

function die(message: string): never {
	console.error(`\nexp-014: ${message}`);
	process.exit(1);
}

async function evalString(browser: CmuxBrowserHandle, expression: string): Promise<string> {
	const output = await Bun.$`cmux --json browser ${browser.surface} eval ${expression}`.json();
	const candidate = output.value ?? output.result ?? output.output;
	if (typeof candidate === "string") return candidate;
	return JSON.stringify(candidate ?? output);
}

async function state(browser: CmuxBrowserHandle): Promise<string> {
	return evalString(browser, "document.body.dataset.state || 'idle'");
}

async function reload(browser: CmuxBrowserHandle): Promise<void> {
	await Bun.$`cmux --json browser ${browser.surface} reload`.quiet();
	await Bun.sleep(250);
}

async function execute(
	browser: CmuxBrowserHandle,
	steps: Step[],
	target: "broken" | "fixed",
	onState?: (value: string) => void,
): Promise<void> {
	for (const step of steps) {
		switch (step.op) {
			case "goto":
				await browser.goto(`${BASE}/${target}?run=${crypto.randomUUID()}`);
				break;
			case "click":
				await browser.click(step.selector!);
				break;
			case "wait":
				await browser.wait(step.ms!);
				break;
			case "reload":
				await reload(browser);
				break;
			case "snapshot":
				await browser.snapshot();
				onState?.(await state(browser));
				break;
		}
	}
}

async function investigate(candidate: Candidate): Promise<Candidate> {
	const browser = await openCmuxBrowser();
	const states: string[] = [];
	try {
		await execute(browser, candidate.steps, "broken", (value) => states.push(value));
		return { ...candidate, status: states.includes("resumed") ? "candidate" : "not-found" };
	} finally {
		await browser.close();
	}
}

async function replay(target: "broken" | "fixed", run: number, steps: Step[]): Promise<ReplayResult> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 2; attempt++) {
		const browser = await openCmuxBrowser();
		const states: string[] = [];
		try {
			await execute(browser, steps, target, (value) => states.push(value));
		const finalState = await state(browser);
		states.push(finalState);
		const image = await browser.screenshot();
		const screenshot = path.join(EVIDENCE, `${target}-${run}.png`);
		await writeFile(screenshot, image);
			return {
				target,
				run,
				reproduced: finalState === "resumed",
				completionObserved: states.includes("complete"),
				stableCompletionObserved: finalState === "complete",
				states,
				screenshot: path.relative(ROOT, screenshot),
			};
		} catch (error) {
			lastError = error;
			if (attempt === 2) throw error;
			await Bun.sleep(300);
		} finally {
			await browser.close();
		}
	}
	throw lastError;
}

async function main() {
	if (!process.argv.includes("cmux")) die("only --provider cmux is implemented in this prerequisite run");
	await mkdir(EVIDENCE, { recursive: true });

	try {
		const health = await fetch(`${BASE}/health`);
		if (!health.ok) throw new Error(String(health.status));
	} catch {
		die(`fixture is not running; start it with: bun fixture/server.ts`);
	}

	const generated = await candidateSet();
	console.log(`Discovering with four independent cmux surfaces (${generated.mode})…`);
	const discovered = await Promise.all(generated.candidates.map(investigate));
	const promoted = discovered
		.filter((candidate) => candidate.status === "candidate")
		.sort((a, b) => Number(b.steps.some((step) => step.op === "reload")) - Number(a.steps.some((step) => step.op === "reload")))[0];
	if (!promoted) die("no investigator observed the unwanted state");

	console.log("Confirming candidate in fresh surfaces…");
	const broken = [] as ReplayResult[];
	const fixed = [] as ReplayResult[];
	for (let run = 1; run <= RUNS; run++) {
		broken.push(await replay("broken", run, promoted.steps));
		fixed.push(await replay("fixed", run, promoted.steps));
	}

	const gate = {
		broken: broken.every((result) => result.reproduced && result.completionObserved),
		fixed: fixed.every((result) => !result.reproduced && result.stableCompletionObserved),
	};
	const result = {
		version: 1,
		createdAt: new Date().toISOString(),
		provider: "cmux",
		discoveryMode: generated.mode,
		capabilityCaveat: "Fresh surfaces share the Default WebKit profile; fixture session state is reset by unique navigation before each replay.",
		symptom: SYMPTOM,
		discovery: discovered,
		promotedCandidate: promoted,
		confirmation: { broken, fixed, gate, passed: gate.broken && gate.fixed },
	};
	await writeFile(path.join(OUT, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.table(discovered.map(({ investigator, status, hypothesis }) => ({ investigator, status, hypothesis })));
	console.table([...broken, ...fixed].map(({ target, run, states, reproduced }) => ({ target, run, states: states.join(" → "), reproduced })));
	console.log(`\nEvidence: ${path.join(OUT, "result.json")}`);
	if (!result.confirmation.passed) die("confirmation gate failed");
	console.log("PASS: 3/3 broken reproduced and 3/3 fixed stayed complete.");
}

await main();
