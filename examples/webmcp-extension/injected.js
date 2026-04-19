// unsurf injected script — runs in the PAGE's main world.
//
// Responsibilities:
//   1. Listen for "unsurf:register-catalog" postMessage from the content script.
//   2. For each tool in the catalog, register it via navigator.modelContext.registerTool.
//   3. The tool's execute() runs the DSL against the live DOM, using role+name targeting
//      that matches the CONTRACT's Target shape.
//   4. Enforce HITL for risk:"high" via confirm() — replaceable with a nicer UI later.

(() => {
	if (window.__unsurf_registered__) return;
	window.__unsurf_registered__ = true;

	const DSL_OPS = new Set(["click", "fill", "select", "check", "submit", "read"]);

	function byRoleAndName(role, name, nth = 0) {
		// Resilience ladder:
		//   1. Role + exact accessible name
		//   2. Role + substring accessible name (case-insensitive)
		//   3. Any element whose innerText / aria-label / label / placeholder matches
		const all = enumerateByRole(role);
		if (!all.length) return null;

		// Exact
		let match = all.filter(el => accessibleName(el).trim().toLowerCase() === name.toLowerCase());
		if (match[nth]) return match[nth];

		// Loose
		match = all.filter(el => accessibleName(el).toLowerCase().includes(name.toLowerCase()));
		if (match[nth]) return match[nth];

		return null;
	}

	function enumerateByRole(role) {
		const map = {
			button: "button, [role=button]",
			textbox: "input[type=text], input[type=email], input[type=search], input:not([type]), textarea, [role=textbox]",
			searchbox: "input[type=search], [role=searchbox]",
			combobox: "select, [role=combobox]",
			checkbox: "input[type=checkbox], [role=checkbox]",
			radio: "input[type=radio], [role=radio]",
			link: "a[href], [role=link]",
			heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
			img: "img, [role=img]",
			list: "ul, ol, [role=list]",
			listitem: "li, [role=listitem]",
			form: "form, [role=form]",
			navigation: "nav, [role=navigation]",
			dialog: "dialog, [role=dialog]",
			tab: "[role=tab]",
			tabpanel: "[role=tabpanel]",
			region: "[role=region]",
			status: "[role=status]",
			table: "table, [role=table]",
			cell: "td, th, [role=cell]",
			option: "option, [role=option]",
			menu: "[role=menu]",
			menuitem: "[role=menuitem]",
			switch: "[role=switch]",
		};
		const sel = map[role];
		if (!sel) return [];
		return Array.from(document.querySelectorAll(sel));
	}

	function accessibleName(el) {
		const al = el.getAttribute && el.getAttribute("aria-label");
		if (al) return al.trim();
		const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
		if (labelledby) {
			const l = document.getElementById(labelledby);
			if (l) return (l.textContent ?? "").trim();
		}
		const tag = el.tagName && el.tagName.toUpperCase();
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
			if (el.id) {
				const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
				if (lab) return (lab.textContent ?? "").trim();
			}
			const label = el.closest && el.closest("label");
			if (label) return (label.textContent ?? "").trim();
			const ph = el.getAttribute && el.getAttribute("placeholder");
			if (ph) return ph.trim();
			const n = el.getAttribute && el.getAttribute("name");
			if (n) return n.trim();
		}
		return (el.textContent ?? "").trim();
	}

	function substitute(value, args) {
		if (typeof value !== "string") return value;
		return value.replace(/\{\{(\w+)\}\}/g, (_m, k) =>
			args[k] !== undefined ? String(args[k]) : `{{${k}}}`,
		);
	}

	function runDsl(dsl, args) {
		const read_results = [];
		for (const op of dsl) {
			if (!DSL_OPS.has(op.op)) throw new Error(`unknown op ${op.op}`);
			const el = byRoleAndName(op.target.role, op.target.name, op.target.nth ?? 0);
			if (!el) throw new Error(`target not found: ${op.target.role}:"${op.target.name}"`);

			if (op.op === "click") {
				el.click();
			} else if (op.op === "fill") {
				const v = substitute(op.value, args);
				el.focus && el.focus();
				// Native setter for React-controlled inputs
				const desc = Object.getOwnPropertyDescriptor(
					el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
					"value",
				);
				if (desc && desc.set) desc.set.call(el, v); else el.value = v;
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.dispatchEvent(new Event("change", { bubbles: true }));
			} else if (op.op === "select") {
				const v = substitute(op.value, args);
				el.value = v;
				el.dispatchEvent(new Event("change", { bubbles: true }));
			} else if (op.op === "check") {
				if (op.value) {
					if (!el.checked) el.click();
				} else {
					if (el.checked) el.click();
				}
			} else if (op.op === "submit") {
				const form = el.closest && el.closest("form");
				if (form && form.requestSubmit) form.requestSubmit();
				else if (form && form.submit) form.submit();
				else if (el.tagName === "FORM") {
					el.requestSubmit ? el.requestSubmit() : el.submit();
				} else {
					throw new Error("submit: no form context");
				}
			} else if (op.op === "read") {
				const as = op.as ?? "text";
				if (as === "text") read_results.push(el.innerText ?? el.textContent ?? "");
				else if (as === "value") read_results.push(el.value ?? "");
				else if (as === "attr") read_results.push(el.getAttribute?.(op.attr) ?? "");
			}
		}
		return read_results;
	}

	function confirmHitl(tool, args) {
		// Replaceable with a custom UI; confirm() works everywhere and is blocking.
		const summary = [
			`unsurf: confirm tool call`,
			``,
			`Tool:  ${tool.name}`,
			`Risk:  ${tool.risk.toUpperCase()}`,
			`Page:  ${location.hostname}`,
			``,
			`Arguments:`,
			JSON.stringify(args, null, 2),
			``,
			`Proceed?`,
		].join("\n");
		return window.confirm(summary);
	}

	function buildExecute(tool) {
		return async (args) => {
			if (tool.risk === "high") {
				if (!confirmHitl(tool, args)) {
					return { content: [{ type: "text", text: "cancelled by user (HITL rejected)" }] };
				}
			}
			try {
				const reads = runDsl(tool.dsl, args ?? {});
				const resultText = reads.length ? reads.join("\n") : `ok: ${tool.name}`;
				return { content: [{ type: "text", text: resultText }] };
			} catch (e) {
				return { content: [{ type: "text", text: `error: ${e?.message ?? e}` }], isError: true };
			}
		};
	}

	async function register(catalog) {
		for (let i = 0; i < 50; i++) {
			if (navigator.modelContext) break;
			await new Promise(r => setTimeout(r, 50));
		}
		if (!navigator.modelContext) {
			console.warn("[unsurf] navigator.modelContext never appeared; is the polyfill loaded?");
			return;
		}
		for (const tool of catalog.tools) {
			try {
				navigator.modelContext.registerTool({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					execute: buildExecute(tool),
				});
			} catch (e) {
				console.warn(`[unsurf] registerTool failed for ${tool.name}:`, e?.message ?? e);
			}
		}
		console.log(`[unsurf] registered ${catalog.tools.length} tool(s) on ${location.host}`);
	}

	window.addEventListener("message", (ev) => {
		if (ev.source !== window) return;
		const msg = ev.data;
		if (!msg || msg.type !== "unsurf:register-catalog") return;
		register(msg.catalog);
	});
})();
