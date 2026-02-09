/**
 * LLM-guided Scout Agent
 *
 * Uses an LLM to decide what to click, type, and navigate during scouting.
 * The browser captures network events in the background while the LLM explores.
 */
import { Effect, Stream } from "effect";
import type { BrowserError } from "../domain/Errors.js";
import type { NetworkEvent } from "../domain/NetworkEvent.js";
import type { BrowserService } from "../services/Browser.js";

// ==================== Types ====================

export interface AgentAction {
	readonly type: "navigate" | "click" | "type" | "wait" | "evaluate" | "done";
	readonly selector?: string | undefined;
	readonly value?: string | undefined;
	readonly url?: string | undefined;
	readonly reason: string;
}

export interface AgentStep {
	readonly action: AgentAction;
	readonly networkEventsCollected: number;
	readonly pageUrl: string;
}

export interface LlmProvider {
	readonly decide: (context: LlmContext) => Effect.Effect<AgentAction, BrowserError>;
}

export interface LlmContext {
	readonly task: string;
	readonly currentUrl: string;
	readonly pageContent: string;
	readonly stepsCompleted: ReadonlyArray<AgentStep>;
	readonly networkEventCount: number;
}

// ==================== Agent ====================

export const MAX_AGENT_STEPS = 10;

/**
 * Run an LLM-guided exploration of a site.
 * The LLM decides what to do, the browser executes, CDP captures network events.
 */
export function runScoutAgent(opts: {
	readonly browser: BrowserService;
	readonly llm: LlmProvider;
	readonly url: string;
	readonly task: string;
}): Effect.Effect<
	{ steps: ReadonlyArray<AgentStep>; events: ReadonlyArray<NetworkEvent> },
	BrowserError
> {
	return Effect.gen(function* () {
		const { browser, llm, url, task } = opts;
		const steps: AgentStep[] = [];

		// Navigate to the starting URL
		yield* browser.navigate(url);

		for (let i = 0; i < MAX_AGENT_STEPS; i++) {
			// Get current page state
			const currentUrl = yield* browser.evaluate("window.location.href");
			const pageContent = yield* getPageSummary(browser);
			const events = yield* browser.getNetworkEvents();

			// Ask the LLM what to do
			const action = yield* llm.decide({
				task,
				currentUrl: String(currentUrl),
				pageContent,
				stepsCompleted: steps,
				networkEventCount: events.length,
			});

			// Execute the action
			yield* executeAction(browser, action);

			const postEvents = yield* browser.getNetworkEvents();
			steps.push({
				action,
				networkEventsCollected: postEvents.length,
				pageUrl: String(currentUrl),
			});

			if (action.type === "done") break;
		}

		const allEvents = yield* browser.getNetworkEvents();
		return { steps, events: allEvents };
	});
}

// ==================== Helpers ====================

const PAGE_SUMMARY_SCRIPT = `(() => {
	const links = Array.from(document.querySelectorAll('a[href]'))
		.slice(0, 20)
		.map(a => '<a href="' + a.getAttribute('href') + '">' + (a.textContent || '').trim() + '</a>');
	const forms = Array.from(document.querySelectorAll('form')).map(f => {
		const inputs = Array.from(f.querySelectorAll('input, textarea, select')).map(i =>
			'<' + i.tagName.toLowerCase() + ' name="' + (i.getAttribute('name') || '') + '" type="' + (i.getAttribute('type') || 'text') + '">'
		);
		return '<form action="' + f.action + '">' + inputs.join('') + '</form>';
	});
	const buttons = Array.from(document.querySelectorAll('button, [role=button]'))
		.slice(0, 10)
		.map(b => '<button>' + (b.textContent || '').trim() + '</button>');
	const title = document.title;
	const meta = (document.querySelector('meta[name="description"]') || {}).content || '';
	return [
		'Title: ' + title,
		meta ? 'Description: ' + meta : '',
		links.length ? 'Links:\\n' + links.join('\\n') : 'No links',
		forms.length ? 'Forms:\\n' + forms.join('\\n') : 'No forms',
		buttons.length ? 'Buttons:\\n' + buttons.join('\\n') : 'No buttons',
	].filter(Boolean).join('\\n\\n');
})()`;

function getPageSummary(browser: BrowserService): Effect.Effect<string, BrowserError> {
	return browser.evaluate(PAGE_SUMMARY_SCRIPT) as Effect.Effect<string, BrowserError>;
}

function executeAction(
	browser: BrowserService,
	action: AgentAction,
): Effect.Effect<void, BrowserError> {
	switch (action.type) {
		case "navigate":
			return action.url ? browser.navigate(action.url) : Effect.void;
		case "click":
			return action.selector ? browser.click(action.selector) : Effect.void;
		case "type":
			return action.selector && action.value !== undefined
				? browser.type(action.selector, action.value)
				: Effect.void;
		case "wait":
			return action.selector ? browser.waitForSelector(action.selector) : Effect.void;
		case "evaluate":
			return action.value ? browser.evaluate(action.value).pipe(Effect.asVoid) : Effect.void;
		case "done":
			return Effect.void;
	}
}

// ==================== System Prompt ====================

export const SCOUT_SYSTEM_PROMPT = `You are a web exploration agent. Your job is to navigate websites and trigger as many API calls as possible.

You will receive the current page state (URL, links, forms, buttons) and must decide the next action.

Respond with a JSON object:
{
  "type": "navigate" | "click" | "type" | "wait" | "evaluate" | "done",
  "selector": "CSS selector (for click, type, wait)",
  "value": "text to type (for type) or JS to evaluate (for evaluate)",
  "url": "URL to navigate to (for navigate)",
  "reason": "why you're taking this action"
}

Strategy:
- Click links that look like they load data (dashboard, list, detail pages)
- Submit forms to trigger POST requests
- Click buttons that trigger AJAX calls
- Navigate to different sections of the site
- When you've explored enough or can't find more API calls, respond with type "done"
- Be efficient — don't revisit pages you've already seen
`;
