(async () => {
	const { unsurf_visits = [], unsurf_api = "https://unsurf-api.coey.dev" } =
		await chrome.storage.local.get(["unsurf_visits", "unsurf_api"]);

	const statusEl = document.getElementById("status");
	const visitsEl = document.getElementById("visits");
	const apiEl = document.getElementById("api");

	apiEl.value = unsurf_api;
	apiEl.addEventListener("change", async () => {
		await chrome.storage.local.set({ unsurf_api: apiEl.value.trim() });
	});

	const recent = unsurf_visits.slice(0, 20);
	const hits = recent.filter((v) => v.catalog && v.catalog.tool_count > 0).length;
	statusEl.textContent = `${hits} / ${recent.length} pages scouted`;

	if (recent.length === 0) {
		visitsEl.innerHTML = `<div class="empty">
			Visit some sites — if they're in the unsurf Directory,
			their tools will appear in your MCP client.
		</div>`;
		return;
	}

	visitsEl.innerHTML = recent.map((v) => {
		const host = (() => { try { return new URL(v.href).host; } catch { return v.origin; } })();
		const path = (() => { try { return new URL(v.href).pathname; } catch { return ""; } })();
		const hit = v.catalog && v.catalog.tool_count > 0;
		const badge = hit
			? `<span class="badge hit">${v.catalog.tool_count} tool${v.catalog.tool_count > 1 ? "s" : ""}</span>`
			: `<span class="badge miss">—</span>`;
		return `
			<div class="row">
				<div class="origin">${host}${badge}</div>
				<div class="sub">${path}</div>
			</div>
		`;
	}).join("");
})();
