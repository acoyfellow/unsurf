/**
 * Step tracer — wraps any BrowserHandle in a Proxy that logs every call to a
 * growing `TraceStep[]`. The wrapped handle is indistinguishable from the
 * underlying one; callers pass it to their run() callback unchanged.
 *
 * Design note: Proxy over hand-written forwarder because new BrowserHandle
 * methods should start being traced immediately, with zero extra wiring.
 * `startRecording`/`stopRecording`/`close` are skipped — they're infra, not
 * the user's action surface.
 */

import type { BrowserHandle, TraceStep } from "./types.js";

const TRACED_OPS = new Set<TraceStep["op"]>([
	"goto",
	"click",
	"fill",
	"wait",
	"snapshot",
	"screenshot",
]);

function flattenArgs(op: TraceStep["op"], args: unknown[]): TraceStep["args"] {
	// Keep args tiny; the video is the full picture.
	const pick = (k: string, v: unknown): [string, string | number | boolean] | null => {
		if (v === undefined || v === null) return null;
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return [k, v];
		return [k, JSON.stringify(v).slice(0, 200)];
	};

	const out: TraceStep["args"] = {};
	switch (op) {
		case "goto": {
			const e = pick("url", args[0]);
			if (e) out[e[0]] = e[1];
			break;
		}
		case "click": {
			const e = pick("selector", args[0]);
			if (e) out[e[0]] = e[1];
			break;
		}
		case "fill": {
			const sel = pick("selector", args[0]);
			if (sel) out[sel[0]] = sel[1];
			const val = args[1];
			if (typeof val === "string") {
				// Truncate big values, redact obvious secrets.
				out.value = val.length > 80 ? `${val.slice(0, 80)}…` : val;
			}
			break;
		}
		case "wait": {
			const v = args[0];
			if (typeof v === "number") out.ms = v;
			else if (v && typeof v === "object" && "selector" in v) {
				out.selector = String((v as { selector: unknown }).selector);
			}
			break;
		}
		default:
			break;
	}
	return out;
}

export interface TracedHandle {
	handle: BrowserHandle;
	steps: TraceStep[];
	start: number;
}

/**
 * Wrap a BrowserHandle to capture every traced call. Returns the Proxy and a
 * live `steps` array the caller can drain at end-of-run.
 */
export function traceHandle(inner: BrowserHandle): TracedHandle {
	const steps: TraceStep[] = [];
	const start = Date.now();

	const proxy = new Proxy(inner, {
		get(target, prop: string | symbol, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof prop !== "string" || typeof value !== "function") return value;
			if (!TRACED_OPS.has(prop as TraceStep["op"])) return value.bind(target);

			const op = prop as TraceStep["op"];
			return async (...args: unknown[]) => {
				const t = Date.now() - start;
				const callStart = Date.now();
				try {
					const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
					steps.push({
						t,
						op,
						args: flattenArgs(op, args),
						status: "ok",
						durationMs: Date.now() - callStart,
					});
					return result;
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					steps.push({
						t,
						op,
						args: flattenArgs(op, args),
						status: "err",
						error: message.slice(0, 300),
						durationMs: Date.now() - callStart,
					});
					throw e;
				}
			};
		},
	});

	return { handle: proxy, steps, start };
}
