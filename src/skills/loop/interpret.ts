/**
 * Spec interpreter — walks a LoopSpec and drives a BrowserHandle.
 *
 * Pure data-in, no eval, no code. Each LoopStep maps 1:1 to a handle
 * method. The refiner LLM emits JSON only; we do the dispatching here.
 */

import type { BrowserHandle } from "../record/types.js";
import type { LoopSpec, LoopStep } from "./types.js";

export async function runSpec(spec: LoopSpec, browser: BrowserHandle): Promise<void> {
	if (spec.url) {
		await browser.goto(spec.url);
	}
	for (const step of spec.steps) {
		await runStep(step, browser);
	}
}

async function runStep(step: LoopStep, browser: BrowserHandle): Promise<void> {
	switch (step.op) {
		case "goto":
			await browser.goto(step.url);
			return;
		case "fill":
			await browser.fill(step.selector, step.value);
			return;
		case "click":
			await browser.click(step.selector);
			return;
		case "wait":
			await browser.wait(step.ms);
			return;
		case "waitFor":
			await browser.wait({
				selector: step.selector,
				...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
			});
			return;
		case "snapshot":
			await browser.snapshot();
			return;
		default: {
			// Exhaustiveness check — caller sent an unknown op. Refuse
			// rather than silently skip so bad specs are caught loudly.
			const bad = step as { op?: string };
			throw new Error(`runSpec: unknown step op "${bad.op ?? "<missing>"}"`);
		}
	}
}

/**
 * Validate a spec shape before we try to run it. Cheaper than a browser
 * round-trip when the refiner hallucinates a bad op or forgets a field.
 */
export function validateSpec(spec: unknown): LoopSpec {
	if (!spec || typeof spec !== "object") throw new Error("spec must be an object");
	const s = spec as Record<string, unknown>;
	if (s.url !== undefined && typeof s.url !== "string")
		throw new Error("spec.url must be a string");
	if (!Array.isArray(s.steps)) throw new Error("spec.steps must be an array");
	for (let i = 0; i < s.steps.length; i++) {
		const step = s.steps[i] as Record<string, unknown>;
		if (!step || typeof step !== "object") throw new Error(`spec.steps[${i}] must be an object`);
		const op = step.op;
		switch (op) {
			case "goto":
				if (typeof step.url !== "string") throw new Error(`steps[${i}].url must be a string`);
				break;
			case "fill":
				if (typeof step.selector !== "string" || typeof step.value !== "string")
					throw new Error(`steps[${i}] fill needs selector+value strings`);
				break;
			case "click":
				if (typeof step.selector !== "string")
					throw new Error(`steps[${i}].selector must be a string`);
				break;
			case "wait":
				if (typeof step.ms !== "number")
					throw new Error(`steps[${i}].ms must be a number (milliseconds)`);
				break;
			case "waitFor":
				if (typeof step.selector !== "string")
					throw new Error(`steps[${i}].selector must be a string`);
				break;
			case "snapshot":
				break;
			default:
				throw new Error(`steps[${i}].op "${String(op)}" is not a valid op`);
		}
	}
	return s as unknown as LoopSpec;
}
