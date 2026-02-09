/**
 * Anthropic Claude provider for the Scout Agent
 */
import { Effect } from "effect";
import { BrowserError } from "../domain/Errors.js";
import type { AgentAction, LlmContext, LlmProvider } from "./ScoutAgent.js";
import { SCOUT_SYSTEM_PROMPT } from "./ScoutAgent.js";

export interface AnthropicConfig {
	readonly apiKey: string;
	readonly model?: string | undefined;
}

export function makeAnthropicProvider(config: AnthropicConfig): LlmProvider {
	const model = config.model ?? "claude-sonnet-4-20250514";

	return {
		decide: (context: LlmContext) =>
			Effect.tryPromise({
				try: async () => {
					const userMessage = [
						`Task: ${context.task}`,
						`Current URL: ${context.currentUrl}`,
						`Network events captured so far: ${context.networkEventCount}`,
						`Steps completed: ${context.stepsCompleted.length}`,
						context.stepsCompleted.length > 0
							? `Recent actions: ${context.stepsCompleted
									.slice(-3)
									.map((s) => `${s.action.type}: ${s.action.reason}`)
									.join(", ")}`
							: "",
						`\nPage content:\n${context.pageContent}`,
					]
						.filter(Boolean)
						.join("\n");

					const response = await fetch("https://api.anthropic.com/v1/messages", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"x-api-key": config.apiKey,
							"anthropic-version": "2023-06-01",
						},
						body: JSON.stringify({
							model,
							max_tokens: 512,
							system: SCOUT_SYSTEM_PROMPT,
							messages: [{ role: "user", content: userMessage }],
						}),
					});

					if (!response.ok) {
						const text = await response.text();
						throw new Error(`Anthropic API error ${response.status}: ${text}`);
					}

					const data = (await response.json()) as {
						content: Array<{ type: string; text?: string | undefined }>;
					};
					const text = data.content.find((c) => c.type === "text")?.text;
					if (!text) throw new Error("No text in Anthropic response");

					// Extract JSON from the response (handle markdown code blocks)
					const jsonMatch = text.match(/\{[\s\S]*\}/);
					if (!jsonMatch) throw new Error(`No JSON found in LLM response: ${text}`);

					return JSON.parse(jsonMatch[0]) as AgentAction;
				},
				catch: (e) => new BrowserError({ message: `LLM decision failed: ${e}` }),
			}),
	};
}
