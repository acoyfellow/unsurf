import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openCmuxBrowser, type CmuxBrowserHandle } from "../../src/skills/record/index.js";

const ROOT = new URL(".", import.meta.url).pathname;
const OUT = path.join(ROOT, "out");
const EVIDENCE = path.join(OUT, "evidence");
const FIXTURE_PORT = Number(process.env.EXP014_PORT ?? 4178);
const BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const RUNS = 3;

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

const candidates: Candidate[] = [
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
	} finally {
		await browser.close();
	}
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

	console.log("Discovering with four independent cmux surfaces…");
	const discovered = await Promise.all(candidates.map(investigate));
	const promoted = discovered.find((candidate) => candidate.investigator === "lifecycle-recovery");
	if (!promoted || promoted.status !== "candidate") die("no lifecycle recovery candidate was discovered");

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
		capabilityCaveat: "Fresh surfaces share the Default WebKit profile; fixture session state is reset by unique navigation before each replay.",
		symptom: "The response looked complete, but then it continued unexpectedly.",
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
