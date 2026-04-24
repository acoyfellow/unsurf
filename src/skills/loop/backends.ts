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

/**
 * Call a Workers AI text-gen model with server-side guided JSON decoding.
 *
 * Takes a JSON schema; the inference runtime enforces it, so the returned
 * message.content is guaranteed to parse and match the shape. Works
 * across models (Kimi, Llama, Gemma, Mistral …) — the enforcement is in
 * the runtime, not the prompt.
 *
 * Docs: https://developers.cloudflare.com/workers-ai/features/json-mode/
 */
async function callJsonSchema<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
	const c = creds();
	const url = `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/ai/run/${DEFAULT_SYNTHESIS_MODEL}`;
	const res = await fetch(url, {
		method: "POST",
		headers: { authorization: `Bearer ${c.apiToken}`, "content-type": "application/json" },
		body: JSON.stringify({
			messages: [{ role: "user", content: prompt }],
			max_tokens: 4000,
			temperature: 0.1,
			response_format: { type: "json_schema", json_schema: schema },
		}),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`workers-ai call failed ${res.status}: ${detail.slice(0, 400)}`);
	}
	const data = (await res.json()) as { result?: ChatResult; success?: boolean };
	if (data.success === false) throw new Error("workers-ai call returned success=false");
	// With json_schema, message.content (when non-empty) is guaranteed
	// structured JSON. Never fall back to reasoning_content.
	const r = data.result || {};
	const text = (r.response || r.choices?.[0]?.message?.content || "").trim();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(
			`workers-ai returned non-JSON despite json_schema response_format (likely token-truncated reasoning): ${text.slice(0, 300)}`,
		);
	}
}

// ==================== Default planner ====================

const OP_DOCS = `
Valid ops:
  { "op": "goto",     "url": "<string>" }
  { "op": "fill",     "selector": "<css>", "value": "<string>" }
  { "op": "click",    "selector": "<css>" }
  { "op": "wait",     "ms": <number> }
  { "op": "waitFor",  "selector": "<css>", "timeoutMs": <number> }
  { "op": "snapshot" }
`.trim();

/**
 * JSON schema for a LoopSpec. Uses `oneOf` on each step so the inference
 * runtime enforces the discriminated union at decode time — impossible
 * for the model to emit an unknown op or miss a required field.
 */
const STEP_SCHEMA = {
	oneOf: [
		{
			type: "object",
			properties: { op: { const: "goto" }, url: { type: "string" } },
			required: ["op", "url"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: {
				op: { const: "fill" },
				selector: { type: "string" },
				value: { type: "string" },
			},
			required: ["op", "selector", "value"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { op: { const: "click" }, selector: { type: "string" } },
			required: ["op", "selector"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { op: { const: "wait" }, ms: { type: "number" } },
			required: ["op", "ms"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: {
				op: { const: "waitFor" },
				selector: { type: "string" },
				timeoutMs: { type: "number" },
			},
			required: ["op", "selector"],
			additionalProperties: false,
		},
		{
			type: "object",
			properties: { op: { const: "snapshot" } },
			required: ["op"],
			additionalProperties: false,
		},
	],
} as const;

const SPEC_SCHEMA = {
	type: "object",
	properties: {
		url: { type: "string" },
		steps: { type: "array", items: STEP_SCHEMA },
		notes: { type: "string" },
	},
	required: ["steps"],
} as const;

/**
 * Refiner may either propose a new spec OR signal give-up. Kept as one
 * schema so the runtime's guided decoder picks exactly one branch. We
 * disambiguate in code by checking `giveUp`.
 */
const REFINER_SCHEMA = {
	oneOf: [
		SPEC_SCHEMA,
		{
			type: "object",
			properties: { giveUp: { const: true } },
			required: ["giveUp"],
			additionalProperties: false,
		},
	],
} as const;

const YES_NO_SCHEMA = {
	type: "object",
	properties: { yes: { type: "boolean" } },
	required: ["yes"],
	additionalProperties: false,
} as const;

export function kimiPlanner(): Planner {
	return {
		async plan({ goal, northStar }) {
			const prompt = [
				"You convert a natural-language browser task into a structured JSON spec.",
				"",
				`GOAL: ${goal}`,
				`NORTH STAR (success condition): ${northStar}`,
				"",
				OP_DOCS,
				"",
				"Rules:",
				"  - Prefer stable selectors (input[name], aria-label, id) over nth-child.",
				"  - Insert short waits (wait 400-800ms) between actions that likely trigger re-renders.",
				"  - Use waitFor when you expect a specific element to appear.",
				"  - Keep the plan minimal. 5-10 steps is usually enough.",
			].join("\n");
			const raw = await callJsonSchema<Record<string, unknown>>(prompt, SPEC_SCHEMA);
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
				"PREVIOUS SPEC:",
				JSON.stringify(previousSpec, null, 2),
				"",
				"OBSERVATION OF PREVIOUS RUN:",
				previousAnswer,
				`(confidence: ${previousConfidence})`,
				"",
				'Return a NEW spec more likely to meet the North Star, OR {"giveUp": true} if you cannot improve on the previous attempt.',
				"",
				OP_DOCS,
			].join("\n");
			const raw = await callJsonSchema<Record<string, unknown>>(prompt, REFINER_SCHEMA);
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
	].join("\n");
	const r = await callJsonSchema<{ yes?: boolean }>(prompt, YES_NO_SCHEMA);
	return r.yes === true;
}

export function asLoopSpec(s: unknown): LoopSpec {
	return validateSpec(s);
}
