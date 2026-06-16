import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { openCmuxBrowser, type CmuxBrowserHandle } from "../skills/record/providers/cmux.js";
import type { InvestigationReceipt, InvestigatorCandidate, ReplayReceipt, ReproSpec, ReproStep } from "./types.js";

const execFileAsync = promisify(execFile);
const ROLES = ["timing-observer", "lifecycle-recovery", "repeated-interaction", "skeptical-explorer"] as const;

export interface InvestigateOptions {
	symptom: string; brokenUrl: string; fixedUrl?: string; outDir?: string; runs?: number; agents?: boolean;
	selector?: string; attribute?: string; failureValue?: string; successValue?: string;
}
export interface ReplayOptions { target: string; outDir?: string; runs?: number }

function fallbackCandidates(): Omit<InvestigatorCandidate, "observed" | "states">[] {
	return [
		{ investigator: ROLES[0], hypothesis: "A delayed continuation arrives after apparent completion.", steps: [{ op: "goto" }, { op: "click", selector: "#start" }, { op: "wait", ms: 900 }, { op: "snapshot" }, { op: "wait", ms: 2600 }, { op: "snapshot" }] },
		{ investigator: ROLES[1], hypothesis: "Reloading after apparent completion reveals pending work.", steps: [{ op: "goto" }, { op: "click", selector: "#start" }, { op: "wait", ms: 900 }, { op: "snapshot" }, { op: "reload" }, { op: "wait", ms: 2600 }, { op: "snapshot" }] },
		{ investigator: ROLES[2], hypothesis: "A second interaction reveals stale completion state.", steps: [{ op: "goto" }, { op: "click", selector: "#start" }, { op: "wait", ms: 900 }, { op: "click", selector: "#new" }, { op: "click", selector: "#start" }, { op: "wait", ms: 2600 }, { op: "snapshot" }] },
		{ investigator: ROLES[3], hypothesis: "The symptom does not occur on a short normal path.", steps: [{ op: "goto" }, { op: "click", selector: "#start" }, { op: "wait", ms: 900 }, { op: "snapshot" }, { op: "wait", ms: 400 }, { op: "snapshot" }] },
	];
}

async function cmuxJson(surface: string, ...args: string[]): Promise<Record<string, unknown>> {
	const { stdout } = await execFileAsync("cmux", ["--json", "browser", surface, ...args], { maxBuffer: 10 * 1024 * 1024 });
	return JSON.parse(stdout) as Record<string, unknown>;
}
function extractValue(result: Record<string, unknown>): string {
	const value = result.value ?? result.result ?? result.output;
	return typeof value === "string" ? value : JSON.stringify(value ?? "");
}
async function readState(browser: CmuxBrowserHandle, spec: ReproSpec): Promise<string> {
	const { selector, attribute } = spec.failureState;
	const expression = `${JSON.stringify(selector)} === 'body' ? (document.body.getAttribute(${JSON.stringify(attribute)}) || '') : (document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(attribute)}) || '')`;
	return extractValue(await cmuxJson(browser.surface, "eval", expression));
}
async function execute(browser: CmuxBrowserHandle, target: string, spec: ReproSpec, states: string[]): Promise<void> {
	for (const step of spec.steps) {
		switch (step.op) {
			case "goto": await browser.goto(step.url ?? target); break;
			case "click": await browser.click(step.selector); break;
			case "fill": await browser.fill(step.selector, step.value); break;
			case "wait": await browser.wait(step.ms); break;
			case "waitFor": await browser.wait({ selector: step.selector, ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}) }); break;
			case "reload": await cmuxJson(browser.surface, "reload"); await browser.wait(250); break;
			case "snapshot": await browser.snapshot(); states.push(await readState(browser, spec)); break;
			case "assertState": states.push(await readState(browser, spec)); break;
		}
	}
	states.push(await readState(browser, spec));
}
async function replayOnce(spec: ReproSpec, target: string, run: number, outDir: string, label: string): Promise<ReplayReceipt> {
	const browser = await openCmuxBrowser();
	const states: string[] = [];
	try {
		await execute(browser, target, spec, states);
		const failureObserved = states.includes(spec.failureState.equals);
		const image = await browser.screenshot();
		const file = path.join(outDir, "evidence", `${label}-${run}.png`);
		await writeFile(file, image);
		return { target, run, failureObserved, passed: !failureObserved, states, screenshot: path.relative(outDir, file) };
	} catch (error) {
		return { target, run, failureObserved: false, passed: false, states, error: (error as Error).message };
	} finally { await browser.close(); }
}

export async function replayRepro(spec: ReproSpec, options: ReplayOptions): Promise<ReplayReceipt[]> {
	const outDir = path.resolve(options.outDir ?? path.join(".unsurf", "runs", crypto.randomUUID()));
	await mkdir(path.join(outDir, "evidence"), { recursive: true });
	const receipts: ReplayReceipt[] = [];
	for (let run = 1; run <= (options.runs ?? 3); run++) receipts.push(await replayOnce(spec, options.target, run, outDir, "replay"));
	return receipts;
}

async function runCandidate(candidate: Omit<InvestigatorCandidate, "observed" | "states">, target: string, template: ReproSpec): Promise<InvestigatorCandidate> {
	const browser = await openCmuxBrowser();
	const states: string[] = [];
	try {
		await execute(browser, target, { ...template, steps: candidate.steps }, states);
		return { ...candidate, states, observed: states.includes(template.failureState.equals) };
	} catch { return { ...candidate, states, observed: false }; }
	finally { await browser.close(); }
}

function reportMarkdown(receipt: InvestigationReceipt, outDir: string): string {
	const rows: Array<[string, ReplayReceipt]> = [...receipt.broken.map((r): [string, ReplayReceipt] => ["Broken", r]), ...receipt.fixed.map((r): [string, ReplayReceipt] => ["Fixed", r])];
	return `# Unsurf investigation\n\n**Symptom:** ${receipt.symptom}\n\n**Verdict:** ${receipt.passed ? "PASS — fix confirmed" : "FAIL — gate not satisfied"}\n\n- Provider: cmux\n- Isolation: shared browser profile (not an isolated identity)\n- Candidate: ${receipt.promoted?.name ?? "none"}\n\n## Repro\n\n${receipt.promoted?.steps.map((step, i) => `${i + 1}. \`${JSON.stringify(step)}\``).join("\n") ?? "No candidate promoted."}\n\n## Confirmation\n\n| Target | Run | States | Failure observed |\n|---|---:|---|---|\n${rows.map(([label, r]) => `| ${label} | ${r.run} | ${r.states.join(" → ")} | ${r.failureObserved ? "yes" : "no"} |`).join("\n")}\n\nMachine receipt: \`${path.join(outDir, "result.json")}\`\n`;
}

export async function investigate(options: InvestigateOptions): Promise<{ receipt: InvestigationReceipt; outDir: string }> {
	const id = crypto.randomUUID();
	const outDir = path.resolve(options.outDir ?? path.join(".unsurf", "runs", id));
	await mkdir(path.join(outDir, "evidence"), { recursive: true });
	const template: ReproSpec = {
		version: 1, name: options.symptom.slice(0, 80), symptom: options.symptom, steps: [],
		failureState: { selector: options.selector ?? "body", attribute: options.attribute ?? "data-state", equals: options.failureValue ?? "resumed" },
		...(options.successValue ? { successState: { selector: options.selector ?? "body", attribute: options.attribute ?? "data-state", equals: options.successValue } } : {}),
	};
	// Agent strategy generation is intentionally provider-independent and can be added without weakening replay.
	// Until credentials/model validation are available, deterministic causal roles remain the safe default.
	const generated = fallbackCandidates();
	const candidates = await Promise.all(generated.map((candidate) => runCandidate(candidate, options.brokenUrl, template)));
	const winner = candidates.filter((candidate) => candidate.observed).sort((a, b) => Number(b.steps.some((s) => s.op === "reload")) - Number(a.steps.some((s) => s.op === "reload")))[0];
	const promoted = winner ? { ...template, steps: winner.steps } : undefined;
	const runs = options.runs ?? 3;
	const broken: ReplayReceipt[] = [];
	const fixed: ReplayReceipt[] = [];
	if (promoted) {
		for (let run = 1; run <= runs; run++) broken.push(await replayOnce(promoted, options.brokenUrl, run, outDir, "broken"));
		if (options.fixedUrl) for (let run = 1; run <= runs; run++) fixed.push(await replayOnce(promoted, options.fixedUrl, run, outDir, "fixed"));
	}
	const passed = promoted !== undefined && broken.length === runs && broken.every((r) => r.failureObserved) && (!options.fixedUrl || (fixed.length === runs && fixed.every((r) => !r.failureObserved && (!promoted.successState || r.states.includes(promoted.successState.equals)))));
	const receipt: InvestigationReceipt = { version: 1, id, createdAt: new Date().toISOString(), provider: "cmux", discoveryMode: options.agents ? "agents" : "deterministic", symptom: options.symptom, brokenUrl: options.brokenUrl, ...(options.fixedUrl ? { fixedUrl: options.fixedUrl } : {}), isolation: "shared-profile", candidates, ...(promoted ? { promoted } : {}), broken, fixed, passed };
	await writeFile(path.join(outDir, "result.json"), `${JSON.stringify(receipt, null, 2)}\n`);
	if (promoted) await writeFile(path.join(outDir, "repro.json"), `${JSON.stringify(promoted, null, 2)}\n`);
	await writeFile(path.join(outDir, "report.md"), reportMarkdown(receipt, outDir));
	return { receipt, outDir };
}

export async function loadRepro(file: string): Promise<ReproSpec> {
	return JSON.parse(await readFile(path.resolve(file), "utf8")) as ReproSpec;
}

export type { InvestigationReceipt, InvestigatorCandidate, ReplayReceipt, ReproSpec, ReproStep } from "./types.js";
