#!/usr/bin/env bun
/**
 * exp-007 — URL+DOM fingerprint strategies
 * Capture 10 URLs at T0. Simulate mutation sets M1/M2/M3. Recompute 4 fingerprint strategies.
 * Tabulate collision (false-match) and miss (false-miss) rates.
 *
 * Amendments: AMD-005 (swap to available logged-in/personal targets)
 *
 * Implementation notes:
 * - T0↔T1 Wayback drift: fetch live AND Wayback snapshot where available. If Wayback fails, skip that row.
 * - Mutations are applied to T0 cleaned HTML string directly, simulating known-breakage scenarios.
 * - "Accessibility tree" is approximated from regex extraction of (role, accessible-name-ish) pairs.
 *   Real AX tree would need Puppeteer; this is a structural-only experiment.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const URLS: { slug: string; url: string }[] = [
	{ slug: "httpbin-forms-post", url: "https://httpbin.org/forms/post" },
	{ slug: "hn-submit", url: "https://news.ycombinator.com/submit" },
	{ slug: "hn-main", url: "https://news.ycombinator.com/" },
	{ slug: "wikipedia-webmcp", url: "https://en.wikipedia.org/wiki/Accessibility" },
	{ slug: "mdn-fetch", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API" },
	{ slug: "example-com", url: "https://example.com/" },
	{ slug: "mdn-index", url: "https://developer.mozilla.org/en-US/" },
	// AMD-005:
	{ slug: "midjourney-explore", url: "https://www.midjourney.com/explore" },
	{ slug: "coey-projects", url: "https://coey.dev/projects" },
	{ slug: "jordancoeyman-home", url: "https://jordancoeyman.com/" },
];

function sha256(s: string) { return "sha256:" + createHash("sha256").update(s).digest("hex"); }

async function fetchHtml(url: string) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 15000);
	try {
		const r = await fetch(url, {
			signal: ctrl.signal,
			headers: { "User-Agent": "Mozilla/5.0 Chrome/132" },
			redirect: "follow",
		});
		return { ok: r.ok, html: await r.text(), status: r.status };
	} catch (e: any) { return { ok: false, html: "", status: 0, err: String(e?.message ?? e) }; }
	finally { clearTimeout(t); }
}

async function fetchWayback(url: string) {
	// CDX to find closest snapshot at least 30 days old
	const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&limit=10&from=20250101&to=20260101&output=json&filter=statuscode:200`;
	try {
		const r = await fetch(cdx, { signal: AbortSignal.timeout(20000) });
		if (!r.ok) return null;
		const j = (await r.json()) as any[];
		if (!Array.isArray(j) || j.length < 2) return null;
		const latest = j[j.length - 1];
		const ts = latest[1]; // timestamp
		const originalUrl = latest[2];
		const snapUrl = `https://web.archive.org/web/${ts}/${originalUrl}`;
		const rr = await fetch(snapUrl, { signal: AbortSignal.timeout(20000), redirect: "follow" });
		if (!rr.ok) return null;
		return { ok: true, html: await rr.text(), ts, snapUrl };
	} catch { return null; }
}

function normalizeHtml(html: string) {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<svg[\s\S]*?<\/svg>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function extractFormActions(html: string): string[] {
	const out = new Set<string>();
	for (const m of html.matchAll(/<form[^>]*\saction=["']([^"']+)["']/gi)) out.add(m[1]);
	return [...out].sort();
}

function extractRoleNamePairs(html: string): string[] {
	// Rough approximation — enough for fingerprint stability checks.
	const pairs = new Set<string>();
	// <button>label</button>
	for (const m of html.matchAll(/<button\b[^>]*>([^<]{1,80})<\/button>/gi)) {
		pairs.add(`button:${m[1].trim().toLowerCase()}`);
	}
	// <a>label</a>  (role=link)
	for (const m of html.matchAll(/<a\b[^>]*>([^<]{1,80})<\/a>/gi)) {
		pairs.add(`link:${m[1].trim().toLowerCase()}`);
	}
	// input name / placeholder / aria-label
	for (const m of html.matchAll(/<input\b[^>]*\s(?:name|placeholder|aria-label)=["']([^"']{1,80})["']/gi)) {
		pairs.add(`textbox:${m[1].trim().toLowerCase()}`);
	}
	// aria-label on any element
	for (const m of html.matchAll(/\saria-label=["']([^"']{1,80})["']/gi)) {
		pairs.add(`aria:${m[1].trim().toLowerCase()}`);
	}
	// headings
	for (const m of html.matchAll(/<h[1-6]\b[^>]*>([^<]{1,80})<\/h[1-6]>/gi)) {
		pairs.add(`heading:${m[1].trim().toLowerCase()}`);
	}
	return [...pairs].sort();
}

function extractTagStructure(html: string): string {
	// DFS-ish tag order, attribute-free, text-free
	const tags: string[] = [];
	for (const m of html.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)) {
		const t = m[1].toLowerCase();
		// skip noise
		if (t === "meta" || t === "link" || t === "br") continue;
		tags.push(t);
	}
	return tags.join(",");
}

// Fingerprint strategies
function F1(url: string) { return sha256(url.split("#")[0]); }
function F2(url: string, html: string) {
	const actions = extractFormActions(html);
	return sha256(url.split("#")[0] + "|" + actions.join("\n"));
}
function F3(url: string, html: string) {
	const pairs = extractRoleNamePairs(html);
	return sha256(url.split("#")[0] + "|" + pairs.join("\n"));
}
function F4(url: string, html: string) {
	return sha256(url.split("#")[0] + "|" + extractTagStructure(html));
}

function mutateRenameLabel(html: string) {
	// Rename "Email" → "Email address" in any context
	return html.replace(/>Email</g, ">Email address<").replace(/name=["']email["']/gi, 'name="email" placeholder="Email address"');
}

function mutateRemoveSubmit(html: string) {
	return html
		.replace(/<button\b[^>]*type=["']submit["'][^>]*>[\s\S]*?<\/button>/gi, "")
		.replace(/<input\b[^>]*type=["']submit["'][^>]*\/?>/gi, "");
}

function mutateInjectTracking(html: string) {
	// Inject hidden div + tracking script comment (no visible change)
	const inj = `<!-- tracking --><div hidden aria-hidden="true" style="display:none">x</div><noscript></noscript>`;
	// Insert just before </body> if present, else at the end
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, inj + "</body>");
	return html + inj;
}

async function main() {
	const outDir = import.meta.dir;
	await mkdir(`${outDir}/captures/T0`, { recursive: true });
	await mkdir(`${outDir}/captures/T1`, { recursive: true });
	await mkdir(`${outDir}/captures/mutated`, { recursive: true });
	await mkdir(`${outDir}/out`, { recursive: true });

	const records: any[] = [];

	for (const { slug, url } of URLS) {
		console.log(`== ${slug}`);
		const t0 = await fetchHtml(url);
		if (!t0.ok || !t0.html) { console.log(`  ✗ T0 fetch failed status=${t0.status}`); continue; }
		const h0 = normalizeHtml(t0.html);
		await writeFile(`${outDir}/captures/T0/${slug}.html`, h0);

		// T1: Wayback
		const wb = await fetchWayback(url);
		let h1: string | null = null, t1Mode: string = "none";
		if (wb?.ok && wb.html) {
			h1 = normalizeHtml(wb.html);
			await writeFile(`${outDir}/captures/T1/${slug}.html`, h1);
			t1Mode = `wayback@${wb.ts}`;
		}

		// Mutations
		const m1 = mutateRenameLabel(h0);
		const m2 = mutateRemoveSubmit(h0);
		const m3 = mutateInjectTracking(h0);
		await writeFile(`${outDir}/captures/mutated/${slug}-m1.html`, m1);
		await writeFile(`${outDir}/captures/mutated/${slug}-m2.html`, m2);
		await writeFile(`${outDir}/captures/mutated/${slug}-m3.html`, m3);

		// Fingerprints
		const fps = (label: string, html: string) => ({
			label,
			F1: F1(url),
			F2: F2(url, html),
			F3: F3(url, html),
			F4: F4(url, html),
		});
		const fpT0 = fps("T0", h0);
		const fpT1 = h1 ? fps("T1", h1) : null;
		const fpM1 = fps("M1", m1);
		const fpM2 = fps("M2", m2);
		const fpM3 = fps("M3", m3);

		// Pair matches
		const compare = (a: any, b: any) => ({
			F1: a.F1 === b.F1,
			F2: a.F2 === b.F2,
			F3: a.F3 === b.F3,
			F4: a.F4 === b.F4,
		});

		const pairs = {
			"T0↔T0": compare(fpT0, fpT0), // tautology, sanity
			"T0↔T1": fpT1 ? compare(fpT0, fpT1) : null,
			"T0↔M1": compare(fpT0, fpM1), // M1 = benign label rename; SHOULD NOT match tool-safely
			"T0↔M2": compare(fpT0, fpM2), // M2 = submit removed; SHOULD NOT match
			"T0↔M3": compare(fpT0, fpM3), // M3 = invisible injection; benign, matching is FINE (cache hit)
		};

		records.push({ slug, url, t1Mode, pairs, bytes_T0: h0.length });
		console.log(`  T0 bytes=${h0.length}  T1=${t1Mode}`);
		for (const [p, c] of Object.entries(pairs)) {
			if (!c) { console.log(`  ${p}: N/A`); continue; }
			console.log(`  ${p}: F1=${c.F1?"✓":"✗"} F2=${c.F2?"✓":"✗"} F3=${c.F3?"✓":"✗"} F4=${c.F4?"✓":"✗"}`);
		}
	}

	// Score:
	// Ideal: T0↔T1 = match (cache hit). T0↔M1/M2 = no match (correctly invalidates). T0↔M3 = match (invisible change = cache hit).
	const strategies = ["F1", "F2", "F3", "F4"] as const;
	const score: Record<string, any> = {};
	for (const s of strategies) {
		const T0_T1_match = records.filter(r => r.pairs["T0↔T1"]?.[s] === true).length;
		const T0_T1_total = records.filter(r => r.pairs["T0↔T1"] !== null).length;
		const T0_M1_match = records.filter(r => r.pairs["T0↔M1"][s] === true).length;
		const T0_M2_match = records.filter(r => r.pairs["T0↔M2"][s] === true).length;
		const T0_M3_match = records.filter(r => r.pairs["T0↔M3"][s] === true).length;
		score[s] = {
			// "Hit rate" — would cache be warm across unchanged capture?
			T0_T1_hit: T0_T1_total ? `${T0_T1_match}/${T0_T1_total}` : "n/a",
			// "False match on breaking mutations" — LOWER is better. Ideal = 0%.
			T0_M1_false_match: `${T0_M1_match}/${records.length}`,
			T0_M2_false_match: `${T0_M2_match}/${records.length}`,
			// "Hit on invisible change" — HIGHER is better (cache utility).
			T0_M3_hit: `${T0_M3_match}/${records.length}`,
		};
	}

	const summary = {
		ran_at: new Date().toISOString(),
		n_urls: URLS.length,
		records_with_T1: records.filter(r => r.pairs["T0↔T1"] !== null).length,
		strategies: score,
	};

	await writeFile(`${outDir}/out/records.json`, JSON.stringify(records, null, 2));
	await writeFile(`${outDir}/out/summary.json`, JSON.stringify(summary, null, 2));

	console.log("\n=== SUMMARY ===");
	console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
