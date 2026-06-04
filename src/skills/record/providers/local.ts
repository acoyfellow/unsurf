/**
 * Local provider — shells out to `agent-browser`, one session per call.
 *
 * The agent-browser CLI owns the actual Chrome lifecycle, cookies, profile
 * dir, CDP connection, and WebM encoder. We just wrap its subcommands behind
 * BrowserHandle.
 *
 * Every record() call gets a fresh `--session <id>` so parallel runs on the
 * same machine don't collide.
 */

import { spawn } from "node:child_process";
import type { BrowserHandle } from "../types.js";

export interface LocalProviderOptions {
	/** Path to `agent-browser` binary. Defaults to PATH lookup. */
	bin?: string;
	/** Session id used on every CLI call. Defaults to a random short string. */
	session?: string;
	/** Optional CDP endpoint (port number or ws:// URL) to connect to an existing browser. */
	connect?: number | string;
	closeOnExit?: boolean;
	/** Extra env for the child process. */
	env?: Record<string, string>;
}

function randomSession(): string {
	return `trace-${Math.random().toString(36).slice(2, 10)}`;
}

async function runAb(
	bin: string,
	prefix: string[],
	args: string[],
	env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, [...prefix, ...args], {
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => {
			stdout += c.toString();
		});
		child.stderr.on("data", (c) => {
			stderr += c.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ stdout, stderr, code: code ?? 0 });
		});
	});
}

export async function openLocalBrowser(opts: LocalProviderOptions = {}): Promise<BrowserHandle> {
	const bin = opts.bin ?? "agent-browser";
	const session = opts.session ?? randomSession();
	const env = opts.env;
	const closeOnExit = opts.closeOnExit ?? opts.connect === undefined;
	const prefix =
		opts.connect === undefined ? ["--session", session] : ["--cdp", String(opts.connect)];

	const run = async (args: string[]) => {
		const { stdout, stderr, code } = await runAb(bin, prefix, args, env);
		if (code !== 0) {
			throw new Error(
				`agent-browser ${args.join(" ")} exited ${code}: ${(stderr || stdout).slice(0, 400)}`,
			);
		}
		return stdout;
	};

	return {
		async goto(url) {
			await run(["open", url]);
		},
		async click(selector) {
			await run(["click", selector]);
		},
		async fill(selector, value) {
			await run(["fill", selector, value]);
		},
		async wait(arg) {
			if (typeof arg === "number") {
				await run(["wait", String(arg)]);
			} else {
				const extra = arg.timeoutMs ? ["--timeout", String(arg.timeoutMs)] : [];
				await run(["wait", arg.selector, ...extra]);
			}
		},
		async snapshot() {
			const out = await run(["snapshot", "--json"]);
			try {
				return JSON.parse(out);
			} catch {
				return out;
			}
		},
		async screenshot() {
			// agent-browser writes screenshots to a path; capture to stdout via --json base64.
			// Fall back to a tmpfile when the CLI doesn't expose stdout bytes.
			const tmp = `/tmp/unsurf-shot-${session}-${Date.now()}.png`;
			await run(["screenshot", tmp]);
			const { readFile, rm } = await import("node:fs/promises");
			const buf = await readFile(tmp);
			await rm(tmp, { force: true }).catch(() => {});
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
		},
		async startRecording(path) {
			await run(["record", "start", path]);
		},
		async stopRecording() {
			await run(["record", "stop"]);
		},
		async close() {
			if (!closeOnExit) return;
			await runAb(bin, prefix, ["close"], env).catch(() => {});
		},
	};
}
