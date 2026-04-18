// exp-010 background — collects messages from content scripts for aggregation.
const collected = [];
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "exp010-result") {
		collected.push({ ...msg.result, sender_tab: sender.tab?.url });
		chrome.storage.local.set({ collected });
	}
});
