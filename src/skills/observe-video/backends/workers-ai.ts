/**
 * Workers AI backends for observe-video.
 *
 * Talks to the REST API (api.cloudflare.com/client/v4/accounts/:id/ai/run/:model)
 * so it works from any Node/Bun process, not just inside a Worker.
 *
 * Env vars required:
 *   CLOUDFLARE_ACCOUNT_ID   target account for Workers AI
 *   CLOUDFLARE_API_TOKEN    token with "Workers AI - Read" permission
 *
 * Defaults:
 *   vision model      @cf/meta/llama-3.2-11b-vision-instruct
 *   synthesis model   @cf/moonshotai/kimi-k2-instruct   (Kimi K2 family on Workers AI)
 *
 * Both are overridable via options so we can swap to a bigger/smaller model
 * without code changes.
 */

import type { SynthesisBackend, VisionBackend } from "../types.js";

const DEFAULT_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
// Jordan specified K2.6 explicitly — the frontier 1T param model with 262k
// context, which is overkill for caption synthesis but what's requested.
const DEFAULT_SYNTHESIS_MODEL = "@cf/moonshotai/kimi-k2.6";

export interface WorkersAiCreds {
	accountId: string;
	apiToken: string;
	baseUrl?: string; // default https://api.cloudflare.com/client/v4
}

function credsFromEnv(over?: Partial<WorkersAiCreds>): WorkersAiCreds {
	const accountId = over?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || "";
	const apiToken = over?.apiToken || process.env.CLOUDFLARE_API_TOKEN || "";
	if (!accountId || !apiToken) {
		throw new Error(
			"Workers AI backend requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars (or explicit creds).",
		);
	}
	return { accountId, apiToken, baseUrl: over?.baseUrl || "https://api.cloudflare.com/client/v4" };
}

interface ChatCompletionsResult {
	response?: string;
	choices?: {
		message?: { content?: string | null; reasoning_content?: string | null };
	}[];
}

/** Extract assistant text across the two shapes Workers AI models return. */
function extractAssistantText(r: ChatCompletionsResult): string {
	if (typeof r.response === "string" && r.response.trim()) return r.response.trim();
	const msg = r.choices?.[0]?.message;
	if (msg?.content && msg.content.trim()) return msg.content.trim();
	// Some reasoning models emit only reasoning_content when max_tokens is too low.
	if (msg?.reasoning_content && msg.reasoning_content.trim()) return msg.reasoning_content.trim();
	return "";
}

async function aiRun<T>(
	creds: WorkersAiCreds,
	model: string,
	body: Record<string, unknown>,
): Promise<T> {
	const url = `${creds.baseUrl}/accounts/${creds.accountId}/ai/run/${model}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${creds.apiToken}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`Workers AI ${model} failed (${res.status}): ${detail.slice(0, 400)}`);
	}
	const data = (await res.json()) as { result?: T; success?: boolean; errors?: unknown[] };
	if (data.success === false) {
		throw new Error(`Workers AI ${model} returned success=false: ${JSON.stringify(data.errors)}`);
	}
	if (data.result === undefined) {
		throw new Error(`Workers AI ${model} returned no result field`);
	}
	return data.result;
}

// ==================== Vision ====================

export interface WorkersAiVisionOptions {
	model?: string;
	creds?: Partial<WorkersAiCreds>;
	/** Instruction prepended to every caption request. */
	systemPrompt?: string;
}

const DEFAULT_VISION_PROMPT =
	"You are captioning a single frame from a screen recording of a web browser. " +
	"In one or two sentences, describe what is visible and what the user appears to be doing. " +
	"Be specific about page elements, form fields, button states, and any visible text content. " +
	"Write in past tense as if narrating a recording. Do not speculate about intent beyond what is visible.";

export function workersAiVisionBackend(opts: WorkersAiVisionOptions = {}): VisionBackend {
	const creds = credsFromEnv(opts.creds);
	const model = opts.model || DEFAULT_VISION_MODEL;
	const systemPrompt = opts.systemPrompt || DEFAULT_VISION_PROMPT;

	return {
		async caption(frame) {
			// Workers AI image-to-text accepts raw byte array under "image".
			const result = await aiRun<ChatCompletionsResult & { description?: string }>(creds, model, {
				image: Array.from(frame.png),
				prompt: systemPrompt,
				max_tokens: 300,
			});
			const text =
				(result.description && result.description.trim()) || extractAssistantText(result);
			if (!text) throw new Error(`vision model returned empty caption for frame ${frame.index}`);
			return text;
		},
	};
}

// ==================== Synthesis ====================

export interface WorkersAiSynthesisOptions {
	model?: string;
	creds?: Partial<WorkersAiCreds>;
}

function buildSynthesisPrompt(
	question: string,
	captions: { t: number; caption: string }[],
): string {
	const timeline = captions
		.map(({ t, caption }) => `  [${(t / 1000).toFixed(2)}s] ${caption}`)
		.join("\n");
	return [
		"You are analyzing a recorded browser session to answer a specific question.",
		"Below is a time-ordered list of captions, one per keyframe from the recording.",
		"Use ONLY the evidence in the captions. Do not invent details not present in them.",
		"",
		`QUESTION: ${question}`,
		"",
		"TIMELINE:",
		timeline,
		"",
		"Respond with a single JSON object on one line, no markdown fences, no prose outside the object. Shape:",
		'{"answer": "<natural-language answer>", "confidence": <0.0..1.0>}',
		"confidence is how strongly the captions support the answer. 1.0 = captions directly confirm. 0.5 = partial/ambiguous. 0.0 = no evidence either way.",
	].join("\n");
}

function tryParseJson(text: string): { answer: string; confidence: number } | null {
	// Strip common markdown fences and leading/trailing prose.
	const cleaned = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```\s*$/i, "")
		.trim();
	// Grab the first {...} block if the model wrapped it in prose.
	const match = cleaned.match(/\{[\s\S]*\}/);
	const candidate = match ? match[0] : cleaned;
	try {
		const obj = JSON.parse(candidate) as { answer?: unknown; confidence?: unknown };
		if (typeof obj.answer === "string" && typeof obj.confidence === "number") {
			return { answer: obj.answer, confidence: Math.max(0, Math.min(1, obj.confidence)) };
		}
	} catch {
		/* fall through */
	}
	return null;
}

export function workersAiSynthesisBackend(opts: WorkersAiSynthesisOptions = {}): SynthesisBackend {
	const creds = credsFromEnv(opts.creds);
	const model = opts.model || DEFAULT_SYNTHESIS_MODEL;

	return {
		async synthesize({ question, captions }) {
			const prompt = buildSynthesisPrompt(question, captions);
			const result = await aiRun<ChatCompletionsResult>(creds, model, {
				messages: [{ role: "user", content: prompt }],
				max_tokens: 800,
				temperature: 0.2,
			});
			const text = extractAssistantText(result);
			const parsed = tryParseJson(text);
			if (!parsed) {
				// Fallback: return the raw text with low confidence rather than throwing.
				return {
					answer: text || "(model returned empty response)",
					confidence: 0.0,
					raw: result,
				};
			}
			return { ...parsed, raw: result };
		},
	};
}
