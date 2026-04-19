// unsurf background service worker
//
// Keeps a rolling log of per-tab visits (popup reads it).
// Content scripts send { type: "unsurf:visit", origin, href, catalog } here.

const MAX_VISITS = 100;

async function readVisits() {
	const { unsurf_visits } = await chrome.storage.local.get("unsurf_visits");
	return Array.isArray(unsurf_visits) ? unsurf_visits : [];
}

async function recordVisit(visit) {
	const visits = await readVisits();
	visits.unshift({ ...visit, at: Date.now() });
	while (visits.length > MAX_VISITS) visits.pop();
	await chrome.storage.local.set({ unsurf_visits: visits });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "unsurf:visit") {
		recordVisit({
			origin: msg.origin,
			href: msg.href,
			tabId: sender.tab?.id,
			catalog: msg.catalog ?? null,
		});
		sendResponse({ ok: true });
		return true; // keep channel open for async sendResponse
	}
	return false;
});

// On install, set the default API endpoint.
chrome.runtime.onInstalled.addListener(async () => {
	const { unsurf_api } = await chrome.storage.local.get("unsurf_api");
	if (!unsurf_api) {
		await chrome.storage.local.set({ unsurf_api: "https://unsurf-api.coey.dev" });
	}
});
