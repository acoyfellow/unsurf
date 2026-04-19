#!/usr/bin/env bun
/**
 * Stronger mutations, applied to already-captured T0 files. Re-runs fingerprints.
 * M1: rename the FIRST <button>, <a>, or <input>'s visible text/name/aria-label. Universal.
 * M2: remove the FIRST <form>, <button>, or <a>. Universal.
 * M3: same invisible injection (benign).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const T0Dir = import.meta.dir + "/captures/T0";
const MDir  = import.meta.dir + "/captures/mutated";

function sha256(s: string) { return "sha256:" + createHash("sha256").update(s).digest("hex"); }

function mutateM1(html: string): { changed: boolean; out: string } {
	// Rename the first button/link/input label
	// Try in order: <button>TEXT</button> -> <button>TEXT XYZZY</button>
	const btnRe = /<button\b[^>]*>([^<]{1,80})<\/button>/i;
	const mButton = html.match(btnRe);
	if (mButton) {
		const newLabel = mButton[1].trim() + " XYZZY";
		return { changed: true, out: html.replace(btnRe, `<button>${newLabel}</button>`) };
	}
	const linkRe = /<a\b([^>]*)>([^<]{1,80})<\/a>/i;
	const mLink = html.match(linkRe);
	if (mLink) {
		const newLabel = mLink[2].trim() + " XYZZY";
		return { changed: true, out: html.replace(linkRe, `<a${mLink[1]}>${newLabel}</a>`) };
	}
	const inputRe = /<input\b([^>]*?)\s(?:placeholder|aria-label|name)=["']([^"']{1,80})["']/i;
	const mInput = html.match(inputRe);
	if (mInput) {
		return { changed: true, out: html.replace(mInput[2], mInput[2] + " XYZZY") };
	}
	// Fallback: mutate first heading
	const hRe = /<h[1-6]\b[^>]*>([^<]{1,80})<\/h[1-6]>/i;
	const mH = html.match(hRe);
	if (mH) return { changed: true, out: html.replace(mH[0], mH[0].replace(mH[1], mH[1] + " XYZZY")) };
	return { changed: false, out: html };
}

function mutateM2(html: string): { changed: boolean; out: string } {
	// Remove FIRST <form>...</form>
	const formRe = /<form\b[\s\S]*?<\/form>/i;
	if (formRe.test(html)) return { changed: true, out: html.replace(formRe, "") };
	// Else first <button>
	const btnRe = /<button\b[\s\S]*?<\/button>/i;
	if (btnRe.test(html)) return { changed: true, out: html.replace(btnRe, "") };
	// Else first <a>
	const aRe = /<a\b[^>]*>[\s\S]*?<\/a>/i;
	if (aRe.test(html)) return { changed: true, out: html.replace(aRe, "") };
	return { changed: false, out: html };
}

function mutateM3(html: string): { changed: boolean; out: string } {
	// Invisible, benign
	const inj = `<!-- x --><div hidden style="display:none" aria-hidden="true"></div>`;
	if (/<\/body>/i.test(html)) return { changed: true, out: html.replace(/<\/body>/i, inj + "</body>") };
	return { changed: true, out: html + inj };
}

function extractFormActions(h: string) { const s=new Set<string>(); for(const m of h.matchAll(/<form[^>]*\saction=["']([^"']+)["']/gi))s.add(m[1]); return [...s].sort(); }
function extractRoleNamePairs(h: string) {
	const s=new Set<string>();
	for(const m of h.matchAll(/<button\b[^>]*>([^<]{1,80})<\/button>/gi)) s.add(`button:${m[1].trim().toLowerCase()}`);
	for(const m of h.matchAll(/<a\b[^>]*>([^<]{1,80})<\/a>/gi)) s.add(`link:${m[1].trim().toLowerCase()}`);
	for(const m of h.matchAll(/<input\b[^>]*\s(?:name|placeholder|aria-label)=["']([^"']{1,80})["']/gi)) s.add(`textbox:${m[1].trim().toLowerCase()}`);
	for(const m of h.matchAll(/\saria-label=["']([^"']{1,80})["']/gi)) s.add(`aria:${m[1].trim().toLowerCase()}`);
	for(const m of h.matchAll(/<h[1-6]\b[^>]*>([^<]{1,80})<\/h[1-6]>/gi)) s.add(`heading:${m[1].trim().toLowerCase()}`);
	return [...s].sort();
}
function extractTagStructure(h: string) { const t=[]; for(const m of h.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)){const x=m[1].toLowerCase(); if(x==="meta"||x==="link"||x==="br")continue; t.push(x);} return t.join(","); }

const urlMap: Record<string,string> = {
	"httpbin-forms-post":"https://httpbin.org/forms/post",
	"hn-submit":"https://news.ycombinator.com/submit",
	"hn-main":"https://news.ycombinator.com/",
	"wikipedia-webmcp":"https://en.wikipedia.org/wiki/Accessibility",
	"mdn-fetch":"https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
	"example-com":"https://example.com/",
	"mdn-index":"https://developer.mozilla.org/en-US/",
	"midjourney-explore":"https://www.midjourney.com/explore",
	"coey-projects":"https://coey.dev/projects",
	"jordancoeyman-home":"https://jordancoeyman.com/",
};
const F1 = (u:string)=>sha256(u);
const F2 = (u:string,h:string)=>sha256(u+"|"+extractFormActions(h).join("\n"));
const F3 = (u:string,h:string)=>sha256(u+"|"+extractRoleNamePairs(h).join("\n"));
const F4 = (u:string,h:string)=>sha256(u+"|"+extractTagStructure(h));

const slugs = (await readdir(T0Dir)).filter(f=>f.endsWith(".html")).map(f=>f.replace(".html",""));
const recs: any[] = [];
for (const slug of slugs) {
	const url = urlMap[slug]; if (!url) continue;
	const h0 = await readFile(`${T0Dir}/${slug}.html`, "utf8");
	const t1Path = `${import.meta.dir}/captures/T1/${slug}.html`;
	let h1: string | null = null;
	try { h1 = await readFile(t1Path, "utf8"); } catch {}

	const m1 = mutateM1(h0); const m2 = mutateM2(h0); const m3 = mutateM3(h0);
	await writeFile(`${MDir}/${slug}-m1.html`, m1.out);
	await writeFile(`${MDir}/${slug}-m2.html`, m2.out);
	await writeFile(`${MDir}/${slug}-m3.html`, m3.out);

	const fps = (h:string)=>({F1:F1(url), F2:F2(url,h), F3:F3(url,h), F4:F4(url,h)});
	const fp0 = fps(h0);
	const fp1 = h1 ? fps(h1) : null;
	const fpM1 = fps(m1.out);
	const fpM2 = fps(m2.out);
	const fpM3 = fps(m3.out);
	const cmp = (a:any,b:any)=>({F1:a.F1===b.F1, F2:a.F2===b.F2, F3:a.F3===b.F3, F4:a.F4===b.F4});

	const rec = {
		slug, url,
		byte_deltas: { m1: m1.out.length - h0.length, m2: m2.out.length - h0.length, m3: m3.out.length - h0.length },
		m1_changed: m1.changed, m2_changed: m2.changed,
		pairs: {
			"T0_T1": fp1 ? cmp(fp0, fp1) : null,
			"T0_M1": cmp(fp0, fpM1),
			"T0_M2": cmp(fp0, fpM2),
			"T0_M3": cmp(fp0, fpM3),
		},
	};
	recs.push(rec);
	console.log(`${slug}: m1Δ=${rec.byte_deltas.m1} m2Δ=${rec.byte_deltas.m2} m3Δ=${rec.byte_deltas.m3}`);
	for (const [p,c] of Object.entries(rec.pairs)) {
		if (!c) { console.log(`  ${p}: N/A`); continue; }
		console.log(`  ${p}: F1=${c.F1?"✓":"✗"} F2=${c.F2?"✓":"✗"} F3=${c.F3?"✓":"✗"} F4=${c.F4?"✓":"✗"}`);
	}
}

// Score
const keys = ["F1","F2","F3","F4"] as const;
const score: any = {};
const n = recs.length;
for (const k of keys) {
	const T01 = recs.filter(r=>r.pairs.T0_T1?.[k] === true).length;
	const T01n = recs.filter(r=>r.pairs.T0_T1 !== null).length;
	const M1fm = recs.filter(r=>r.pairs.T0_M1[k] === true).length;
	const M2fm = recs.filter(r=>r.pairs.T0_M2[k] === true).length;
	const M3hit = recs.filter(r=>r.pairs.T0_M3[k] === true).length;
	score[k] = {
		T0_T1_hit: `${T01}/${T01n}`,
		// LOW is better (correctly invalidates on breaking change)
		T0_M1_false_match_rate: `${M1fm}/${n}`,
		T0_M2_false_match_rate: `${M2fm}/${n}`,
		// HIGH is better (cache warm on invisible change)
		T0_M3_hit_rate: `${M3hit}/${n}`,
	};
}
const summary = { ran_at: new Date().toISOString(), n_urls: n, records_with_T1: recs.filter(r=>r.pairs.T0_T1).length, strategies: score };
await writeFile(`${import.meta.dir}/out/records.json`, JSON.stringify(recs, null, 2));
await writeFile(`${import.meta.dir}/out/summary.json`, JSON.stringify(summary, null, 2));
console.log("\n=== SUMMARY ===\n" + JSON.stringify(summary, null, 2));
