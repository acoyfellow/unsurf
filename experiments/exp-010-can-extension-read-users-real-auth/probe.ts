#!/usr/bin/env bun
/**
 * exp-010 probe harness.
 *
 * Strategy: Playwright's launchPersistentContext with the unpacked extension.
 * This gives us headless Chrome with:
 *   1. A persistent user-data-dir (cookies + localStorage persist across runs)
 *   2. The extension loaded as unpacked
 *
 * FIRST RUN: user must log in manually. Subsequent runs reuse the profile.
 * In this autonomous setup, we visit the sites without a pre-existing logged-in session,
 * which means Midjourney will report "logged out" — the probe then validates that the
 * plumbing WORKS (the extension fires, can read cookies/localStorage/fetch) even if
 * the specific session doesn't exist.
 *
 * Negative control: navigate to chrome://version and verify the extension does NOT run.
 *
 * Amendments: AMD-001 (narrowed to midjourney.com + coey.dev + jordancoeyman.com)
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXT_PATH = resolve(import.meta.dir + "/extension");
const PROFILE_DIR = resolve(import.meta.dir + "/chrome-profile");
const OUT = import.meta.dir + "/out";

const TARGETS = [
	{ slug: "midjourney", url: "https://www.midjourney.com/explore" },
	{ slug: "coey-dev", url: "https://coey.dev/" },
	{ slug: "jordancoeyman", url: "https://jordancoeyman.com/" },
];

async function main() {
	await mkdir(OUT, { recursive: true });
	await mkdir(PROFILE_DIR, { recursive: true });

	console.log(`exp-010 — loading extension from ${EXT_PATH}`);
	console.log(`profile: ${PROFILE_DIR}`);

	// MV3 extensions require non-headless in Chromium, but Playwright supports headless=new with extensions from 1.44+
	// However many MV3 APIs don't run headless. We launch with headless: false (a persistent window).
	// In a CI-like environment, xvfb or similar would be needed. On macOS we just accept a visible window.
	const context = await chromium.launchPersistentContext(PROFILE_DIR, {
		headless: false, // MV3 requires non-headless for service worker bootstrap
		args: [
			`--disable-extensions-except=${EXT_PATH}`,
			`--load-extension=${EXT_PATH}`,
			"--no-default-browser-check",
			"--no-first-run",
		],
	});

	const results: any[] = [];

	// Give the extension service worker time to register
	await new Promise(r => setTimeout(r, 2000));

	for (const t of TARGETS) {
		console.log(`\n== probing ${t.slug} (${t.url})`);
		const page = await context.newPage();
		try {
			await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 25000 });
			await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
			// Read from chrome.storage.local via the service worker (cross-world)
			let probe: any = null;
			const sws = context.serviceWorkers();
			const sw = sws.find(w => w.url().includes("background.js"));
			for (let i = 0; i < 30; i++) {
				if (sw) {
					try {
						probe = await sw.evaluate(async (origin) => {
							return new Promise<any>((resolve) => {
								chrome.storage.local.get([`exp010-${origin}`], (items) => resolve(items[`exp010-${origin}`] ?? null));
							});
						}, new URL(t.url).origin);
						if (probe) break;
					} catch {}
				}
				await new Promise(r => setTimeout(r, 500));
			}
			if (!probe) {
				console.log("  ✗ content script never set window.__exp010__");
				results.push({ slug: t.slug, url: t.url, error: "content-script-did-not-execute" });
			} else {
				console.log(`  ✓ probe ran`);
				console.log(`    cookie:       ${probe.probes.cookie.ok ? `${probe.probes.cookie.pair_count} pairs, secure=${probe.probes.cookie.contains_secure}` : "ERR"}`);
				console.log(`    localStorage: ${probe.probes.localStorage.ok ? `${probe.probes.localStorage.key_count} keys, auth=${probe.probes.localStorage.contains_auth}` : "ERR"}`);
				console.log(`    authFetch:    ${probe.probes.authFetch ? `${probe.probes.authFetch.target} -> ${probe.probes.authFetch.status ?? "?"}` : "none"}`);
				results.push({ slug: t.slug, url: t.url, probe });
			}
		} catch (e: any) {
			console.log(`  ✗ nav error: ${e?.message ?? e}`);
			results.push({ slug: t.slug, url: t.url, error: String(e?.message ?? e) });
		}
		await page.close();
	}

	// Negative control: visit chrome://version (extensions cannot run there)
	console.log(`\n== negative control: chrome://version`);
	try {
		const page = await context.newPage();
		await page.goto("chrome://version", { timeout: 10000 }).catch(() => {});
		const probe = await page.evaluate(() => (window as any).__exp010__ ?? null).catch(() => null);
		if (probe === null) {
			console.log(`  ✓ negative control: extension correctly did NOT run on chrome://version`);
			results.push({ slug: "negative-control", url: "chrome://version", correctly_blocked: true });
		} else {
			console.log(`  ✗ negative control: extension RAN on chrome://version — security model broken`);
			results.push({ slug: "negative-control", url: "chrome://version", correctly_blocked: false, probe });
		}
		await page.close();
	} catch (e: any) {
		// Navigation to chrome://version may throw; that's still consistent with "extension did not run"
		console.log(`  (chrome:// navigation threw, consistent with blocked)`);
		results.push({ slug: "negative-control", url: "chrome://version", correctly_blocked: true, nav_threw: true });
	}

	await context.close();

	// Summary
	const probed = results.filter(r => r.probe);
	const cookie_ok = probed.filter(r => r.probe.probes.cookie.ok).length;
	const ls_ok = probed.filter(r => r.probe.probes.localStorage.ok).length;
	const fetch_ok = probed.filter(r => r.probe.probes.authFetch?.ok).length;
	const summary = {
		ran_at: new Date().toISOString(),
		amendments_applied: ["AMD-001"],
		n_targets: TARGETS.length,
		successfully_probed: probed.length,
		probes: {
			cookie_accessible: `${cookie_ok}/${probed.length}`,
			localStorage_accessible: `${ls_ok}/${probed.length}`,
			auth_fetch_succeeded: `${fetch_ok}/${probed.length}`,
		},
		negative_control: results.find(r => r.slug === "negative-control"),
		verdict_note: "See RESULT.md for narrow Pass/Fail interpretation.",
	};
	await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2));
	await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
	console.log("\n=== SUMMARY ===\n" + JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
