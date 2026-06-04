import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import {
	openBrowserRunBrowser,
	recordBrowserRunSession,
} from "../../src/skills/record/providers/browser-run.js";

interface Env {
	BROWSER: BrowserWorker;
}

async function within<T>(label: string, promise: Promise<T>, ms: number): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function closeBrowser(browser: Awaited<ReturnType<typeof puppeteer.launch>>): Promise<void> {
	try {
		await within("close", browser.close(), 10_000);
	} catch {
		browser.disconnect();
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const startedAt = Date.now();
		const requestUrl = new URL(request.url);
		if (requestUrl.searchParams.has("health")) return Response.json({ ok: true, health: true });
		if (requestUrl.searchParams.has("limits")) {
			return Response.json({ ok: true, limits: await puppeteer.limits(env.BROWSER) });
		}
		if (requestUrl.searchParams.has("history")) {
			return Response.json({ ok: true, history: await puppeteer.history(env.BROWSER) });
		}
		if (requestUrl.pathname.startsWith("/recording/")) {
			const sessionId = requestUrl.pathname.slice("/recording/".length);
			return env.BROWSER.fetch(`https://fake.host/v1/recording/${sessionId}`);
		}
		const rawTarget = requestUrl.searchParams.get("url") ?? "https://unsurf.coey.dev";
		let target: string;
		try {
			target = new URL(rawTarget).toString();
		} catch {
			return Response.json({ ok: false, error: "invalid url" }, { status: 400 });
		}

		if (requestUrl.pathname === "/session-recording-proof") {
			try {
				const recording = await recordBrowserRunSession({
					binding: env.BROWSER,
					viewport: { width: 430, height: 760 },
					run: async (handle) => {
						await handle.goto("https://httpbin.org/forms/post");
						await handle.fill('input[name="custname"]', "Unsurf Cloud Recording");
						await handle.wait(1200);
						return handle.snapshot();
					},
				});
				return Response.json({
					ok: true,
					format: recording.format,
					sessionId: recording.sessionId,
					returned: recording.returned,
					durationMs: Date.now() - startedAt,
				});
			} catch (error) {
				return Response.json(
					{ ok: false, error: (error as Error).message, durationMs: Date.now() - startedAt },
					{ status: 500 },
				);
			}
		}

		if (requestUrl.pathname === "/handle-proof" || requestUrl.pathname === "/form-proof") {
			try {
				const handle = await within(
					"provider.open",
					openBrowserRunBrowser({ binding: env.BROWSER, viewport: { width: 430, height: 760 } }),
					20_000,
				);
				try {
					const ops: string[] = [];
					const providerTarget =
						requestUrl.pathname === "/form-proof" ? "https://httpbin.org/forms/post" : target;
					await within("handle.goto", handle.goto(providerTarget), 25_000);
					ops.push("goto");
					if (requestUrl.pathname === "/form-proof") {
						await within("handle.fill", handle.fill('input[name="custname"]', "Unsurf Browser Run"), 15_000);
						ops.push("fill");
						await within("handle.waitFor", handle.wait({ selector: 'input[name="custname"]' }), 15_000);
						ops.push("waitFor");
					} else {
						await within("handle.wait", handle.wait(500), 5_000);
						ops.push("wait");
					}
					const snapshot = (await within("handle.snapshot", handle.snapshot(), 10_000)) as {
						title: string;
						url: string;
						textPreview: string;
					};
					ops.push("snapshot");
					const screenshot = await within("handle.screenshot", handle.screenshot(), 20_000);
					ops.push("screenshot");
					return Response.json({
						ok: true,
						target: providerTarget,
						pageUrl: snapshot.url,
						title: snapshot.title,
						textPreview: snapshot.textPreview,
						screenshotBytes: screenshot.byteLength,
						ops,
						durationMs: Date.now() - startedAt,
					});
				} finally {
					await handle.close();
				}
			} catch (error) {
				return Response.json(
					{ ok: false, target, error: (error as Error).message, durationMs: Date.now() - startedAt },
					{ status: 500 },
				);
			}
		}

		try {
			console.log("browser-run proof: launch");
			const browser = await within("launch", puppeteer.launch(env.BROWSER), 20_000);
			try {
				console.log("browser-run proof: page");
				const page = await within("newPage", browser.newPage(), 10_000);
				await page.setViewport({ width: 430, height: 760 });

				await within("goto", page.goto(target, { waitUntil: "load", timeout: 20_000 }), 25_000);
				const title = await page.title();
				const pageUrl = page.url();
				const screenshot = await within("screenshot", page.screenshot({ type: "png" }), 20_000);
				await page.close();
				await closeBrowser(browser);

				return Response.json({
					ok: true,
					target,
					pageUrl,
					title,
					screenshotBytes: screenshot.byteLength,
					durationMs: Date.now() - startedAt,
				});
			} catch (error) {
				await closeBrowser(browser);
				throw error;
			}
		} catch (error) {
			return Response.json(
				{ ok: false, target, error: (error as Error).message, durationMs: Date.now() - startedAt },
				{ status: 500 },
			);
		}
	},
};
