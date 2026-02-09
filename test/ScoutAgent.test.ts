import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { AgentAction, LlmProvider } from "../src/ai/ScoutAgent.js";
import { MAX_AGENT_STEPS, runScoutAgent } from "../src/ai/ScoutAgent.js";
import { NetworkEvent } from "../src/domain/NetworkEvent.js";
import { makeTestBrowserWithEvents } from "../src/services/Browser.js";

// ==================== Test LLM Provider ====================

function makeMockLlm(actions: AgentAction[]): LlmProvider {
	let step = 0;
	return {
		decide: () =>
			Effect.succeed(actions[step++] ?? { type: "done" as const, reason: "no more actions" }),
	};
}

const testEvents: NetworkEvent[] = [
	new NetworkEvent({
		requestId: "1",
		url: "https://example.com/api/data",
		method: "GET",
		resourceType: "fetch",
		requestHeaders: {},
		responseStatus: 200,
		responseHeaders: {},
		responseBody: '{"ok":true}',
		timestamp: Date.now(),
	}),
];

describe("ScoutAgent", () => {
	it("runs LLM-guided exploration and collects events", async () => {
		const browser = makeTestBrowserWithEvents(testEvents);
		const llm = makeMockLlm([
			{ type: "click", selector: "a.nav-link", reason: "explore navigation" },
			{ type: "done", reason: "finished exploring" },
		]);

		const result = await Effect.runPromise(
			runScoutAgent({ browser, llm, url: "https://example.com", task: "find APIs" }),
		);

		expect(result.steps).toHaveLength(2);
		expect(result.steps[0]?.action.type).toBe("click");
		expect(result.steps[1]?.action.type).toBe("done");
		expect(result.events).toHaveLength(1);
	});

	it("stops at MAX_AGENT_STEPS if LLM never says done", async () => {
		const browser = makeTestBrowserWithEvents(testEvents);
		const infiniteActions: AgentAction[] = Array.from({ length: 20 }, (_, i) => ({
			type: "click" as const,
			selector: `button.step-${i}`,
			reason: `step ${i}`,
		}));
		const llm = makeMockLlm(infiniteActions);

		const result = await Effect.runPromise(
			runScoutAgent({ browser, llm, url: "https://example.com", task: "explore" }),
		);

		expect(result.steps.length).toBeLessThanOrEqual(MAX_AGENT_STEPS);
	});

	it("handles navigate actions", async () => {
		const browser = makeTestBrowserWithEvents(testEvents);
		const llm = makeMockLlm([
			{ type: "navigate", url: "https://example.com/about", reason: "go to about page" },
			{ type: "done", reason: "done" },
		]);

		const result = await Effect.runPromise(
			runScoutAgent({ browser, llm, url: "https://example.com", task: "explore" }),
		);

		expect(result.steps).toHaveLength(2);
		expect(result.steps[0]?.action.type).toBe("navigate");
	});

	it("handles type actions", async () => {
		const browser = makeTestBrowserWithEvents(testEvents);
		const llm = makeMockLlm([
			{
				type: "type",
				selector: "input[name=email]",
				value: "test@example.com",
				reason: "fill email field",
			},
			{ type: "done", reason: "done" },
		]);

		const result = await Effect.runPromise(
			runScoutAgent({ browser, llm, url: "https://example.com", task: "fill form" }),
		);

		expect(result.steps).toHaveLength(2);
		expect(result.steps[0]?.action.type).toBe("type");
	});
});
