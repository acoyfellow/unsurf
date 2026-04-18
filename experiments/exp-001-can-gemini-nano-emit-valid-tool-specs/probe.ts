import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto("about:blank");
const status = await page.evaluate(async () => {
	try {
		if (typeof (globalThis as any).LanguageModel !== "object" && typeof (globalThis as any).LanguageModel !== "function") {
			return { available: false, reason: "LanguageModel not on globalThis" };
		}
		const avail = await (globalThis as any).LanguageModel.availability?.();
		return { available: avail === "available" || avail === "readily", api_reports: avail };
	} catch (e: any) { return { available: false, error: String(e?.message ?? e) }; }
});
console.log(JSON.stringify(status, null, 2));
await browser.close();
