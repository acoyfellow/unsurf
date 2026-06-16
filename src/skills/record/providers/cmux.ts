import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { BrowserHandle } from "../types.js";

const execFileAsync = promisify(execFile);

export interface BrowserProviderCapabilities {
	snapshots: boolean;
	screenshots: boolean;
	eval: boolean;
	persistentAuth: boolean;
	humanTakeover: boolean;
	recording: boolean;
	tracing: boolean;
	network: boolean;
	isolation: "shared-profile" | "isolated-context" | "isolated-browser" | "unknown";
}

export interface CmuxProviderOptions {
	/** Existing cmux browser surface, e.g. `surface:52`. Opens one when omitted. */
	surface?: string;
	/** Target workspace used only when opening a surface. */
	workspace?: string;
	/** cmux CLI executable. */
	bin?: string;
	/** Close a surface created by this handle. Defaults to true. */
	closeOnExit?: boolean;
}

export interface CmuxBrowserHandle extends BrowserHandle {
	readonly provider: "cmux";
	readonly capabilities: BrowserProviderCapabilities;
	readonly surface: string;
}

type CmuxResult = Record<string, unknown>;

function asRecord(value: unknown): CmuxResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("cmux returned a non-object JSON response");
	}
	return value as CmuxResult;
}

async function runCmux(bin: string, args: string[]): Promise<CmuxResult> {
	try {
		const { stdout } = await execFileAsync(bin, ["--json", "browser", ...args], {
			maxBuffer: 10 * 1024 * 1024,
		});
		return asRecord(JSON.parse(stdout));
	} catch (error) {
		const cause = error as Error & { stdout?: string; stderr?: string };
		throw new Error(
			`cmux browser ${args.join(" ")} failed: ${(cause.stderr || cause.stdout || cause.message).trim().slice(0, 800)}`,
		);
	}
}

async function openSurface(bin: string, opts: CmuxProviderOptions): Promise<string> {
	const args = ["open", "about:blank"];
	if (opts.workspace) args.push("--workspace", opts.workspace);
	args.push("--focus", "false");
	const output = await runCmux(bin, args);
	const surface = output.surface_ref;
	if (typeof surface !== "string" || !surface.startsWith("surface:")) {
		throw new Error("cmux browser open did not return a surface_ref");
	}
	return surface;
}

function temporaryScreenshotPath(): string {
	return `/tmp/unsurf-cmux-${crypto.randomUUID()}.png`;
}

/**
 * Adapt a cmux in-app browser surface to Unsurf's BrowserHandle.
 *
 * cmux browser surfaces use a shared WebKit profile by default. Separate
 * surfaces isolate page/tab state but are not clean browser identities. The
 * capability declaration is deliberately explicit so proof runners do not
 * mistake surface separation for profile isolation or invent CDP artifacts.
 */
export async function openCmuxBrowser(opts: CmuxProviderOptions = {}): Promise<CmuxBrowserHandle> {
	const bin = opts.bin ?? "cmux";
	const ownsSurface = !opts.surface;
	const surface = opts.surface ?? (await openSurface(bin, opts));
	const closeOnExit = opts.closeOnExit ?? ownsSurface;
	let closed = false;

	const command = (args: string[]) => runCmux(bin, [surface, ...args]);

	return {
		provider: "cmux",
		capabilities: {
			snapshots: true,
			screenshots: true,
			eval: true,
			persistentAuth: true,
			humanTakeover: true,
			recording: false,
			tracing: false,
			network: false,
			isolation: "shared-profile",
		},
		surface,
		async goto(url) {
			await command(["navigate", url]);
			await command(["wait", "--load-state", "complete", "--timeout-ms", "20000"]);
		},
		async click(selector) {
			await command(["click", "--selector", selector]);
		},
		async fill(selector, value) {
			await command(["fill", "--selector", selector, "--text", value]);
		},
		async wait(arg) {
			if (typeof arg === "number") {
				await new Promise((resolve) => setTimeout(resolve, arg));
				return;
			}
			await command([
				"wait",
				"--selector",
				arg.selector,
				"--timeout-ms",
				String(arg.timeoutMs ?? 10_000),
			]);
		},
		async snapshot() {
			return command(["snapshot", "--interactive"]);
		},
		async screenshot() {
			const path = temporaryScreenshotPath();
			try {
				await command(["screenshot", "--out", path]);
				const bytes = await readFile(path);
				return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			} finally {
				await rm(path, { force: true }).catch(() => {});
			}
		},
		async startRecording() {
			throw new Error("cmux browser provider does not support screencast recording on WKWebView");
		},
		async stopRecording() {},
		async close() {
			if (closed || !closeOnExit) return;
			closed = true;
			await runCmux(bin, [surface, "close"]).catch(() => {});
		},
	};
}
