// exp-010 content script
// Probes (document.cookie, fetch with credentials, localStorage) on every matching origin.
// Stashes result on window.__exp010__ so the Playwright harness can read it.
(async () => {
	const origin = location.origin;
	const result = {
		origin,
		href: location.href,
		timestamp: new Date().toISOString(),
		probes: {},
	};

	// Probe 1: document.cookie (non-HttpOnly cookies)
	try {
		const cookie = document.cookie || "";
		result.probes.cookie = {
			ok: true,
			hasContent: cookie.length > 0,
			pair_count: cookie.split(";").filter(s => s.trim()).length,
			// For midjourney, specifically check if the __Secure-* cookies are readable — THEY WON'T BE if HttpOnly.
			contains_secure: /__Secure-/.test(cookie) || /auth|session/i.test(cookie),
		};
	} catch (e) {
		result.probes.cookie = { ok: false, error: String(e && e.message || e) };
	}

	// Probe 2: localStorage read
	try {
		const keys = Object.keys(localStorage);
		result.probes.localStorage = {
			ok: true,
			key_count: keys.length,
			keys: keys.slice(0, 20),
			contains_auth: keys.some(k => /user|session|auth|token/i.test(k)),
		};
	} catch (e) {
		result.probes.localStorage = { ok: false, error: String(e && e.message || e) };
	}

	// Probe 3: authenticated fetch — origin-specific targets
	try {
		let probe3 = null;
		if (/midjourney\.com/.test(origin)) {
			// Midjourney has an /api/app/auth/me or similar; try a benign public endpoint that responds differently when logged in.
			const r = await fetch("https://www.midjourney.com/api/app/shared/app-config", { credentials: "include" });
			probe3 = { target: "midjourney app-config", status: r.status, ok: r.ok };
			try {
				const j = await r.json();
				probe3.user_email_present = typeof j?.user?.email === "string";
				probe3.user_id_present = typeof j?.user?.id === "string";
			} catch {}
		} else if (/github\.com$/.test(new URL(origin).hostname) || /github\.com/.test(origin)) {
			const r = await fetch("https://api.github.com/user", { credentials: "include" });
			probe3 = { target: "github /user", status: r.status, ok: r.ok };
			try {
				const j = await r.json();
				probe3.login_present = typeof j?.login === "string";
			} catch {}
		} else if (/coey\.dev|jordancoeyman\.com/.test(origin)) {
			// Personal sites — no auth endpoint; just fetch the root and verify credentials header passes through
			const r = await fetch(origin + "/", { credentials: "include" });
			probe3 = { target: origin + "/", status: r.status, ok: r.ok };
		}
		result.probes.authFetch = probe3 ?? { target: "none", skipped: true };
	} catch (e) {
		result.probes.authFetch = { ok: false, error: String(e && e.message || e) };
	}

	// Share result with background via chrome.storage.local (same across extension contexts)
	try {
		const key = `exp010-${origin}`;
		await chrome.storage.local.set({ [key]: result });
	} catch (e) { console.log("storage.local set failed", e); }
	// Also post to background
	try {
		chrome.runtime?.sendMessage?.({ type: "exp010-result", result });
	} catch {}
	console.log("[exp010]", JSON.stringify(result));
})();
