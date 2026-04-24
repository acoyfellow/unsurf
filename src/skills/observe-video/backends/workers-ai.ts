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
 *   vision model      @cf/google/gemma-3-12b-it   (native multimodal, no license gate)
 *   synthesis model   @cf/moonshotai/kimi-k2.6     (Jordan-specified frontier model)
 *
 * Both are overridable via options so we can swap to a bigger/smaller model
 * without code changes.
 */

import type { SynthesisBackend, VisionBackend } from "../types.js";

// Gemma 3 (12B IT) is a native-multimodal Text Generation model on Workers AI.
// We deliberately avoid @cf/meta/llama-3.2-*-vision-* because those require
// a one-time POST with prompt:'agree' to accept Meta's Community License,
// which blocks CI and anonymous callers.
const DEFAULT_VISION_MODEL = "@cf/google/gemma-3-12b-it";
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
			// OpenAI-style multimodal: text + image_url (data URL). Works on
			// gemma-3, mistral-small-3.1, llama-4-scout, and other native-
			// multimodal Text Generation models on Workers AI. Avoids the
			// Llama click-through that gates @cf/meta/llama-3.2-*-vision-*.
			const b64 = Buffer.from(frame.png).toString("base64");
			const dataUrl = `data:image/png;base64,${b64}`;
			const result = await aiRun<ChatCompletionsResult & { description?: string }>(creds, model, {
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: systemPrompt },
							{ type: "image_url", image_url: { url: dataUrl } },
						],
					},
				],
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
		"Respond with a 2-4 sentence answer plus a confidence score (0.0..1.0).",
		"confidence scale:",
		"  1.0 = captions directly confirm the answer.",
		"  0.5 = partial or ambiguous evidence.",
		"  0.0 = no evidence in captions.",
	].join("\n");
}

/**
 * JSON schema enforced server-side by Workers AI's guided decoding.
 * Model-agnostic: the inference runtime picks exactly this shape
 * regardless of which model is routed (Kimi, Llama, Gemma, Mistral …).
 * Docs: https://developers.cloudflare.com/workers-ai/features/json-mode/
 */
const SYNTHESIS_SCHEMA = {
	type: "object",
	properties: {
		answer: { type: "string" },
		confidence: { type: "number" },
	},
	required: ["answer", "confidence"],
	additionalProperties: false,
} as const;

export function workersAiSynthesisBackend(opts: WorkersAiSynthesisOptions = {}): SynthesisBackend {
	const creds = credsFromEnv(opts.creds);
	const model = opts.model || DEFAULT_SYNTHESIS_MODEL;

	return {
		async synthesize({ question, captions }) {
			const prompt = buildSynthesisPrompt(question, captions);
			const result = await aiRun<ChatCompletionsResult>(creds, model, {
				messages: [{ role: "user", content: prompt }],
				// Reasoning models (like Kimi K2.6) burn tokens on
				// reasoning_content before emitting message.content. 4k
				// leaves room for both; if truncation still happens we want
				// to see the loud error rather than silently fall back.
				max_tokens: 4000,
				temperature: 0.1,
				response_format: { type: "json_schema", json_schema: SYNTHESIS_SCHEMA },
			});
			// With json_schema the inference runtime guarantees message.content
			// (when non-empty) is valid JSON matching the schema. We deliberately
			// DO NOT fall back to reasoning_content here — reasoning is scratch
			// work and by definition not structured output.
			const text = (result.response || result.choices?.[0]?.message?.content || "").trim();
			let parsed: { answer?: unknown; confidence?: unknown };
			try {
				parsed = JSON.parse(text) as { answer?: unknown; confidence?: unknown };
			} catch {
				throw new Error(
					`synthesis backend: model returned non-JSON despite json_schema response_format: ${text.slice(0, 200)}`,
				);
			}
			if (typeof parsed.answer !== "string" || typeof parsed.confidence !== "number") {
				throw new Error(
					`synthesis backend: JSON shape mismatch: ${JSON.stringify(parsed).slice(0, 200)}`,
				);
			}
			return {
				answer: parsed.answer,
				confidence: Math.max(0, Math.min(1, parsed.confidence)),
				raw: result,
			};
		},
	};
}
