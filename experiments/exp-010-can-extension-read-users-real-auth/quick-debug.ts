import { chromium } from "playwright";
import { resolve } from "node:path";
const EXT_PATH = resolve(import.meta.dir + "/extension");
const ctx = await chromium.launchPersistentContext("", {
	headless: false,
	args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});
// Listen for service worker registration
ctx.on("serviceworker", sw => console.log("SW:", sw.url()));
ctx.on("backgroundpage", bg => console.log("BG page:", bg.url()));
await new Promise(r => setTimeout(r, 3000));
console.log("SWs:", ctx.serviceWorkers().map(sw => sw.url()));
console.log("BG pages:", ctx.backgroundPages().map(b => b.url()));
const p = await ctx.newPage();
p.on("console", m => console.log("PAGE:", m.type(), m.text()));
await p.goto("https://jordancoeyman.com/", { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 3000));
const probe = await p.evaluate(() => (window as any).__exp010__ ?? "NOT-SET");
console.log("probe:", JSON.stringify(probe, null, 2));
await ctx.close();
