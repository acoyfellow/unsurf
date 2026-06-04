import type { Page } from "@cloudflare/puppeteer";

export interface BrowserRunHandle {
	goto(url: string): Promise<void>;
	wait(arg: number | { selector: string; timeoutMs?: number }): Promise<void>;
	snapshot(): Promise<{ title: string; url: string; textPreview: string }>;
	screenshot(): Promise<Uint8Array>;
	close(): Promise<void>;
}

export function browserRunHandle(page: Page): BrowserRunHandle {
	return {
		async goto(url) {
			await page.goto(url, { waitUntil: "load", timeout: 20_000 });
		},
		async wait(arg) {
			if (typeof arg === "number") {
				await new Promise((resolve) => setTimeout(resolve, arg));
				return;
			}
			await page.waitForSelector(arg.selector, { timeout: arg.timeoutMs ?? 10_000 });
		},
		async snapshot() {
			const title = await page.title();
			const url = page.url();
			const textPreview = await page.evaluate(() => document.body?.innerText?.slice(0, 240) ?? "");
			return { title, url, textPreview };
		},
		async screenshot() {
			const bytes = await page.screenshot({ type: "png" });
			return new Uint8Array(bytes);
		},
		async close() {
			await page.close();
		},
	};
}
