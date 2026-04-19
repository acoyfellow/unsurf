#!/usr/bin/env bun
/**
 * Diagnostic: enumerate actual (role, accessible-name) pairs on the failed pages
 * using in-page evaluate. Playwright 1.59 doesn't expose page.accessibility directly.
 */

import { chromium } from "playwright";
import { SPECS } from "./specs";

const FAILED = ["duckduckgo-search", "hn-read", "mdn-search", "midjourney-read"];

async function main() {
	const browser = await chromium.launch({ headless: true });
	for (const entry of SPECS) {
		if (!FAILED.includes(entry.slug)) continue;
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		console.log(`\n=== ${entry.slug} | ${entry.url} ===`);
		try {
			await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 20000 });
			await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
			// Enumerate interactive elements and their inferred role + accessible name.
			const pairs: string[] = await page.evaluate(() => {
				function ariaLabel(el: Element): string {
					const al = el.getAttribute("aria-label");
					if (al) return al.trim();
					const labelledby = el.getAttribute("aria-labelledby");
					if (labelledby) {
						const l = document.getElementById(labelledby);
						if (l) return (l.textContent ?? "").trim();
					}
					if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
						const id = el.id;
						if (id) {
							const lab = document.querySelector(`label[for="${id}"]`);
							if (lab) return (lab.textContent ?? "").trim();
						}
						const label = el.closest("label");
						if (label) return (label.textContent ?? "").trim();
						const ph = el.getAttribute("placeholder");
						if (ph) return ph.trim();
						const n = el.getAttribute("name");
						if (n) return n.trim();
					}
					return (el.textContent ?? "").trim().slice(0, 80);
				}
				function role(el: Element): string {
					const r = el.getAttribute("role");
					if (r) return r;
					const tag = el.tagName.toLowerCase();
					switch (tag) {
						case "a": return (el as HTMLAnchorElement).href ? "link" : "";
						case "button": return "button";
						case "input": {
							const type = (el.getAttribute("type") || "text").toLowerCase();
							if (type === "checkbox") return "checkbox";
							if (type === "radio") return "radio";
							if (type === "submit" || type === "button") return "button";
							if (type === "search") return "searchbox";
							return "textbox";
						}
						case "textarea": return "textbox";
						case "select": return "combobox";
						case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
						case "nav": return "navigation";
						case "form": return "form";
						case "img": return "img";
						case "ul": case "ol": return "list";
						case "li": return "listitem";
						case "table": return "table";
						case "td": case "th": return "cell";
					}
					return "";
				}
				const out: string[] = [];
				const els = document.querySelectorAll("a,button,input,textarea,select,h1,h2,h3,nav,form,[role]");
				for (const el of Array.from(els).slice(0, 60)) {
					const r = role(el);
					if (!r) continue;
					const n = ariaLabel(el);
					if (!n) continue;
					out.push(`${r}:${JSON.stringify(n.slice(0, 80))}`);
				}
				return [...new Set(out)];
			});
			console.log(`  Found ${pairs.length} (role:name) pairs:`);
			for (const p of pairs.slice(0, 25)) console.log(`    ${p}`);
		} catch (e: any) {
			console.log(`  ✗ ${e?.message ?? e}`);
		}
		await ctx.close();
	}
	await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
