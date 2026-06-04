import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { recordAttachedLocal } from "./skills/record/index.js";
import { openLocalBrowser } from "./skills/record/providers/local.js";
import type { BrowserHandle } from "./skills/record/types.js";

const DEFAULT_CDP_PORT = 9222;

const actionSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("goto"), url: z.string().url() }),
	z.object({ op: z.literal("click"), selector: z.string().min(1) }),
	z.object({ op: z.literal("fill"), selector: z.string().min(1), value: z.string() }),
	z.object({ op: z.literal("wait"), ms: z.number().int().min(0) }),
	z.object({
		op: z.literal("waitFor"),
		selector: z.string().min(1),
		timeoutMs: z.number().int().positive().optional(),
	}),
	z.object({ op: z.literal("snapshot") }),
	z.object({ op: z.literal("screenshot") }),
]);

type LocalAction = z.infer<typeof actionSchema>;

export interface LocalBrowserSession {
	id: string;
	title: string;
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

export interface LocalActionResult {
	op: LocalAction["op"];
	ok: boolean;
	value?: unknown;
	error?: string;
}

export interface LocalMcpDeps {
	listSessions?: typeof listLocalBrowserSessions;
	openBrowser?: typeof openLocalBrowser;
	recordBrowser?: typeof recordAttachedLocal;
}

function okText(data: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errText(message: string) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
		isError: true as const,
	};
}

function cdpPort(value: number | undefined): number {
	return value ?? DEFAULT_CDP_PORT;
}

async function runAgentBrowserTabs(port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("agent-browser", ["--cdp", String(port), "tab", "list"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error((stderr || stdout || `agent-browser tab list exited ${code}`).trim()));
		});
	});
}

export async function listLocalBrowserSessions(
	port = DEFAULT_CDP_PORT,
	listTabs: (port: number) => Promise<string> = runAgentBrowserTabs,
): Promise<LocalBrowserSession[]> {
	const output = await listTabs(port);
	const sessions: LocalBrowserSession[] = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^.*\[([^\]]+)\]\s+(.+)\s+-\s+(\S+)\s*$/);
		if (!match) continue;
		const [, id, title, url] = match;
		if (!id || !title || !url) continue;
		if (url.startsWith("chrome://") || url.startsWith("devtools://")) continue;
		sessions.push({ id, title, type: "page", url });
	}
	return sessions;
}

export async function runLocalBrowserActions(
	browser: BrowserHandle,
	actions: LocalAction[],
): Promise<LocalActionResult[]> {
	const results: LocalActionResult[] = [];
	for (const action of actions) {
		try {
			switch (action.op) {
				case "goto":
					await browser.goto(action.url);
					results.push({ op: action.op, ok: true });
					break;
				case "click":
					await browser.click(action.selector);
					results.push({ op: action.op, ok: true });
					break;
				case "fill":
					await browser.fill(action.selector, action.value);
					results.push({ op: action.op, ok: true });
					break;
				case "wait":
					await browser.wait(action.ms);
					results.push({ op: action.op, ok: true });
					break;
				case "waitFor":
					await browser.wait({
						selector: action.selector,
						...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {}),
					});
					results.push({ op: action.op, ok: true });
					break;
				case "snapshot":
					results.push({ op: action.op, ok: true, value: await browser.snapshot() });
					break;
				case "screenshot": {
					const image = await browser.screenshot();
					results.push({ op: action.op, ok: true, value: { byteLength: image.byteLength } });
					break;
				}
			}
		} catch (error) {
			results.push({ op: action.op, ok: false, error: (error as Error).message });
			break;
		}
	}
	return results;
}

export function createLocalMcpServer(deps: LocalMcpDeps = {}): McpServer {
	const listSessions = deps.listSessions ?? listLocalBrowserSessions;
	const openBrowser = deps.openBrowser ?? openLocalBrowser;
	const recordBrowser = deps.recordBrowser ?? recordAttachedLocal;
	const server = new McpServer(
		{ name: "unsurf-local", version: "0.4.0" },
		{ capabilities: { tools: {} } },
	);

	server.registerTool(
		"unsurf_local_sessions",
		{
			title: "Unsurf local browser sessions",
			description: "List attachable page targets from a local Chrome DevTools endpoint.",
			inputSchema: {
				cdpPort: z.number().int().positive().optional(),
			},
		},
		async ({ cdpPort: port }) => {
			try {
				const sessions = await listSessions(cdpPort(port));
				return okText({ connected: true, cdpPort: cdpPort(port), sessions });
			} catch (error) {
				return errText((error as Error).message);
			}
		},
	);

	server.registerTool(
		"unsurf_local_execute",
		{
			title: "Unsurf local browser execute",
			description:
				"Execute browser actions against the active page on a local Chrome DevTools endpoint, optionally recording an unsurf trace.",
			inputSchema: {
				cdpPort: z.number().int().positive().optional(),
				actions: z.array(actionSchema).min(1),
				record: z.boolean().optional(),
				task: z.string().min(1).optional(),
				visibility: z.enum(["private", "public"]).optional(),
			},
		},
		async ({ cdpPort: port, actions, record, task, visibility }) => {
			const connect = cdpPort(port);
			try {
				if (record) {
					if (!task) return errText("task is required when record=true");
					const trace = await recordBrowser({
						connect,
						task,
						...(visibility ? { visibility } : {}),
						run: async (browser) => runLocalBrowserActions(browser, actions),
					});
					return okText({ ok: trace.status === "succeeded", cdpPort: connect, trace });
				}
				const browser = await openBrowser({ connect, closeOnExit: false });
				try {
					const results = await runLocalBrowserActions(browser, actions);
					return okText({ ok: results.every((result) => result.ok), cdpPort: connect, results });
				} finally {
					await browser.close();
				}
			} catch (error) {
				return errText((error as Error).message);
			}
		},
	);

	return server;
}

export async function runLocalMcpServer(): Promise<void> {
	const server = createLocalMcpServer();
	await server.connect(new StdioServerTransport());
}

if (import.meta.main) await runLocalMcpServer();
