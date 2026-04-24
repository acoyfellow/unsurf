/**
 * Default backends for loop().
 *
 * All Workers-AI-backed (per the northstar doc: "Workers AI not Anthropic")
 * and all opt-out: callers override via LoopOptions.{planner,refiner,recordFn,observeFn}.
 *
 * Planner + Refiner both talk to Kimi K2.6 with response_format=json_object
 * and a tight prompt so we get a clean LoopSpec without post-hoc scraping.
 */

import { observeVideo } from "../observe-video/index.js";
import { recordLocal } from "../record/index.js";
import { validateSpec } from "./interpret.js";
import type { LoopSpec, ObserveFn, Planner, RecordFn, Refiner } from "./types.js";

const DEFAULT_SYNTHESIS_MODEL = "@cf/moonshotai/kimi-k2.6";

interface WorkersAiCreds {
	accountId: string;
	apiToken: string;
}

function creds(): WorkersAiCreds {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
	const apiToken = process.env.CLOUDFLARE_API_TOKEN || "";
	if (!accountId || !apiToken) {
		throw new Error(
			"loop: default planner/refiner need CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars.",
		);
	}
	return { accountId, apiToken };
}

interface ChatResult {
	response?: string;
	choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
}

function extractText(r: ChatResult): string {
	if (typeof r.response === "string" && r.response.trim()) return r.response.trim();
	const msg = r.choices?.[0]?.message;
	if (msg?.content?.trim()) return msg.content.trim();
	if (msg?.reasoning_content?.trim()) return msg.reasoning_content.trim();
	return "";
}

async function kimiJson<T>(prompt: string): Promise<T> {
	const c = creds();
	const url = `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/ai/run/${DEFAULT_SYNTHESIS_MODEL}`;
	const res = await fetch(url, {
		method: "POST",
		headers: { authorization: `Bearer ${c.apiToken}`, "content-type": "application/json" },
		body: JSON.stringify({
			messages: [{ role: "user", content: prompt }],
			max_tokens: 2000,
			temperature: 0.1,
			response_format: { type: "json_object" },
		}),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`kimi call failed ${res.status}: ${detail.slice(0, 400)}`);
	}
	const data = (await res.json()) as { result?: ChatResult; success?: boolean };
	if (data.success === false) throw new Error("kimi call returned success=false");
	const text = extractText(data.result || {});
	// Strip code fences if the model snuck them in despite response_format.
	const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
	const match = cleaned.match(/\{[\s\S]*\}/);
	const candidate = match ? match[0] : cleaned;
	try {
		return JSON.parse(candidate) as T;
	} catch {
		throw new Error(`kimi returned non-JSON text: ${text.slice(0, 300)}`);
	}
}

// ==================== Default planner ====================

const OP_SCHEMA = `
Valid ops:
  { "op": "goto",     "url": "<string>" }
  { "op": "fill",     "selector": "<css>", "value": "<string>" }
  { "op": "click",    "selector": "<css>" }
  { "op": "wait",     "ms": <number> }
  { "op": "waitFor",  "selector": "<css>", "timeoutMs": <number> }
  { "op": "snapshot" }
`.trim();

export function kimiPlanner(): Planner {
	return {
		async plan({ goal, northStar }) {
			const prompt = [
				"You convert a natural-language browser task into a structured JSON spec.",
				"",
				`GOAL: ${goal}`,
				`NORTH STAR (success condition): ${northStar}`,
				"",
				"Output format: one JSON object, no prose, no markdown fences.",
				'Shape: { "url": "<starting URL or omit>", "steps": [ ...ops ], "notes": "<optional>" }',
				"",
				OP_SCHEMA,
				"",
				"Rules:",
				"  - Prefer stable selectors (input[name], aria-label, id) over nth-child.",
				"  - Insert short waits (wait 400-800ms) between actions that likely trigger re-renders.",
				"  - Use waitFor when you expect a specific element to appear.",
				"  - Keep the plan minimal. 5-10 steps is usually enough.",
				"  - Do NOT include any code, only the ops above.",
				"",
				"Begin your response with the opening brace.",
			].join("\n");
			const raw = await kimiJson<Record<string, unknown>>(prompt);
			return validateSpec(raw);
		},
	};
}

// ==================== Default refiner ====================

export function kimiRefiner(): Refiner {
	return {
		async refine({ northStar, previousSpec, previousAnswer, previousConfidence, iteration }) {
			const prompt = [
				"You are refining a browser automation spec that did not meet its North Star.",
				"",
				`NORTH STAR: ${northStar}`,
				`ITERATION: ${iteration} (0-indexed)`,
				"",
				"PREVIOUS SPEC (JSON):",
				JSON.stringify(previousSpec, null, 2),
				"",
				"OBSERVATION OF PREVIOUS RUN:",
				previousAnswer,
				`(confidence: ${previousConfidence})`,
				"",
				"Your job: return a NEW spec that is more likely to meet the North Star.",
				'If you cannot think of a better plan, return exactly {"giveUp": true}.',
				"",
				"Output format: one JSON object, no prose, no markdown fences.",
				'Either the refined spec shape { url?, steps[], notes? } OR {"giveUp": true}.',
				"",
				OP_SCHEMA,
				"",
				"Begin your response with the opening brace.",
			].join("\n");
			const raw = await kimiJson<Record<string, unknown>>(prompt);
			if (raw.giveUp === true) return null;
			return validateSpec(raw);
		},
	};
}

// ==================== Default record fn ====================

/**
 * Default record: uses the record skill's recordLocal() which shells out
 * to agent-browser, uploads to trace.coey.dev, and returns a signed
 * videoUrl we can hand straight to observeVideo().
 *
 * The loop callback runs against the BrowserHandle; the loop orchestrator
 * interprets the spec inside that callback via runSpec() from interpret.ts.
 */
export function localRecordFn(): RecordFn {
	return async ({ task, run }) => {
		const result = await recordLocal({ task, run, harness: "loop" });
		return {
			traceUrl: result.url,
			...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
		};
	};
}

// ==================== Default observe fn ====================

export function defaultObserveFn(): ObserveFn {
	return async ({ video, question }) => {
		const r = await observeVideo({ video, question, maxFrames: 6 });
		return { answer: r.answer, confidence: r.confidence };
	};
}

/**
 * Shim helper: kimi-based Yes/No classifier used when we just want to
 * know whether the North Star has been hit and the observe pipeline's
 * confidence is borderline. Not wired into default loop() yet; exported
 * for future composition.
 */
export async function kimiYesNo(question: string, evidence: string): Promise<boolean> {
	const prompt = [
		"Answer a yes/no question based only on the provided evidence.",
		"",
		`QUESTION: ${question}`,
		"",
		"EVIDENCE:",
		evidence,
		"",
		'Return JSON: {"yes": true|false}. No prose.',
	].join("\n");
	const r = await kimiJson<{ yes?: boolean }>(prompt);
	return r.yes === true;
}

export function asLoopSpec(s: unknown): LoopSpec {
	return validateSpec(s);
}
