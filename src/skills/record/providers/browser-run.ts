import puppeteer, { type Browser, type BrowserWorker, type Page } from "@cloudflare/puppeteer";
import type { BrowserHandle } from "../types.js";

export interface BrowserRunProviderOptions {
	binding: BrowserWorker;
	viewport?: { width: number; height: number };
	recording?: boolean;
}

export interface BrowserRunHandle extends BrowserHandle {
	sessionId(): string;
}

export interface BrowserRunRecordingResult<T = unknown> {
	sessionId: string;
	format: "rrweb";
	returned: T;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearAndType(page: Page, selector: string, value: string): Promise<void> {
	await page.waitForSelector(selector, { timeout: 10_000 });
	await page.evaluate((target) => {
		const node = Reflect.get(globalThis, "document").querySelector(target) as {
			value?: string;
		} | null;
		if (node && "value" in node) node.value = "";
	}, selector);
	await page.type(selector, value);
}

export async function openBrowserRunBrowser(
	opts: BrowserRunProviderOptions,
): Promise<BrowserRunHandle> {
	const browser: Browser = await puppeteer.launch(
		opts.binding,
		opts.recording ? { recording: true } : undefined,
	);
	const page = await browser.newPage();
	if (opts.viewport) await page.setViewport(opts.viewport);

	let closed = false;
	return {
		sessionId() {
			return browser.sessionId();
		},
		async goto(url) {
			await page.goto(url, { waitUntil: "load", timeout: 20_000 });
		},
		async click(selector) {
			await page.waitForSelector(selector, { timeout: 10_000 });
			await page.click(selector);
		},
		async fill(selector, value) {
			await clearAndType(page, selector, value);
		},
		async wait(arg) {
			if (typeof arg === "number") {
				await sleep(arg);
				return;
			}
			await page.waitForSelector(arg.selector, { timeout: arg.timeoutMs ?? 10_000 });
		},
		async snapshot() {
			return {
				title: await page.title(),
				url: page.url(),
				textPreview: await page.evaluate(() => {
					const body = Reflect.get(Reflect.get(globalThis, "document"), "body") as
						| { innerText?: string }
						| undefined;
					return body?.innerText?.slice(0, 2_000) ?? "";
				}),
			};
		},
		async screenshot() {
			const screenshot = await page.screenshot({ type: "png" });
			return new Uint8Array(screenshot);
		},
		async startRecording() {
			throw new Error("Browser Run provider does not emit Unsurf WebM recordings yet");
		},
		async stopRecording() {},
		async close() {
			if (closed) return;
			closed = true;
			await page.close().catch(() => {});
			await browser.close().catch(() => browser.disconnect());
		},
	};
}

export async function recordBrowserRunSession<T>(opts: {
	binding: BrowserWorker;
	viewport?: { width: number; height: number };
	run: (browser: BrowserRunHandle) => Promise<T>;
}): Promise<BrowserRunRecordingResult<T>> {
	const browser = await openBrowserRunBrowser({
		binding: opts.binding,
		...(opts.viewport ? { viewport: opts.viewport } : {}),
		recording: true,
	});
	const sessionId = browser.sessionId();
	try {
		const returned = await opts.run(browser);
		return { sessionId, format: "rrweb", returned };
	} finally {
		await browser.close();
	}
}
