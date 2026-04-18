/**
 * Hand-written tool-spec.v0.json specs for exp-003.
 * Covers every DSL verb at least once. Mix of page types per BRIEF.
 *
 * Amendments applied: AMD-005 (use Midjourney + coey.dev + jordancoeyman instead of Linear/Gmail/Shopify).
 */

export type Target = { role: string; name: string; nth?: number };
export type DslOp =
	| { op: "click"; target: Target }
	| { op: "fill"; target: Target; value: string }
	| { op: "select"; target: Target; value: string }
	| { op: "check"; target: Target; value: boolean }
	| { op: "submit"; target: Target }
	| { op: "read"; target: Target; as: "text" | "value" | "attr"; attr?: string };

export type Postcondition =
	| { kind: "textPresent"; value: string }
	| { kind: "urlMatches"; pattern: string }
	| { kind: "elementExists"; target: Target };

export type Tool = {
	name: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, any>; required?: string[] };
	dsl: DslOp[];
	risk: "low" | "medium" | "high";
	postcondition?: Postcondition;
};

export type ToolSpec = {
	version: "v0";
	url: string;
	fingerprint: string;
	fingerprintStrategy: string;
	synthesizedAt: string;
	synthesizer: { name: string; model: string; promptHash: string };
	tools: Tool[];
};

// 10 specs, each targeting one page. Emphasizing coverage of the 6 verbs + all 3 postconditions + 3 risk levels.
export const SPECS: { slug: string; url: string; args: Record<string, any>; spec: ToolSpec }[] = [
	// 1. httpbin — form submit, high risk, textPresent postcondition, exercises fill+submit+check+select
	{
		slug: "httpbin-forms-post",
		url: "https://httpbin.org/forms/post",
		args: { custname: "Exp Tester", custtel: "555-0100", custemail: "exp@example.com", delivery: "20:00", comments: "autonomous exp-003 run" },
		spec: {
			version: "v0",
			url: "https://httpbin.org/forms/post",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "submit_order_form",
					description: "Fill and submit the pizza order form.",
					inputSchema: {
						type: "object",
						properties: {
							custname: { type: "string" },
							custtel: { type: "string" },
							custemail: { type: "string" },
							delivery: { type: "string" },
							comments: { type: "string" },
						},
						required: ["custname", "custtel", "custemail"],
					},
					dsl: [
						{ op: "fill", target: { role: "textbox", name: "Customer name:" }, value: "{{custname}}" },
						{ op: "fill", target: { role: "textbox", name: "Telephone:" }, value: "{{custtel}}" },
						{ op: "fill", target: { role: "textbox", name: "E-mail address:" }, value: "{{custemail}}" },
						{ op: "check", target: { role: "radio", name: "Medium" }, value: true },
						{ op: "check", target: { role: "checkbox", name: "Bacon" }, value: true },
						{ op: "fill", target: { role: "textbox", name: "Preferred delivery time:" }, value: "{{delivery}}" },
						{ op: "fill", target: { role: "textbox", name: "Delivery instructions:" }, value: "{{comments}}" },
						{ op: "click", target: { role: "button", name: "Submit order" } },
					],
					risk: "high",
					postcondition: { kind: "textPresent", value: "form" }, // httpbin echoes back
				},
			],
		},
	},
	// 2. DuckDuckGo — search via combobox (role corrected from textbox after inspect.ts)
	{
		slug: "duckduckgo-search",
		url: "https://duckduckgo.com/",
		args: { query: "webmcp synthesis" },
		spec: {
			version: "v0",
			url: "https://duckduckgo.com/",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "search_web",
					description: "Search the web via DuckDuckGo.",
					inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
					dsl: [
						{ op: "fill", target: { role: "combobox", name: "Search with DuckDuckGo" }, value: "{{query}}" },
						{ op: "click", target: { role: "button", name: "Search", nth: 0 } },
					],
					risk: "medium",
					postcondition: { kind: "urlMatches", pattern: "q=" },
				},
			],
		},
	},
	// 3. Wikipedia — read-only, low risk
	{
		slug: "wikipedia-read",
		url: "https://en.wikipedia.org/wiki/Accessibility",
		args: {},
		spec: {
			version: "v0",
			url: "https://en.wikipedia.org/wiki/Accessibility",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "read_article_title_and_first_heading",
					description: "Read the article's title and first section heading.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [
						{ op: "read", target: { role: "heading", name: "Accessibility" }, as: "text" },
					],
					risk: "low",
					postcondition: { kind: "elementExists", target: { role: "heading", name: "Accessibility" } },
				},
			],
		},
	},
	// 4. HackerNews front page — read first story title (via role:link whose name is nontrivial)
	// Note: headless Chrome hit a WebGL error on /item?id=1 with enterprise security injection;
	// switched to /news which renders plainly.
	{
		slug: "hn-read",
		url: "https://news.ycombinator.com/news",
		args: {},
		spec: {
			version: "v0",
			url: "https://news.ycombinator.com/news",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "read_hn_top_story",
					description: "Read the first story's title.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [
						{ op: "read", target: { role: "link", name: "Hacker News" }, as: "text" },
					],
					risk: "low",
				},
			],
		},
	},
	// 5. MDN — read a content link (MDN search is behind a button-then-input interaction that is harder to hand-spec)
	{
		slug: "mdn-read-link",
		url: "https://developer.mozilla.org/en-US/",
		args: {},
		spec: {
			version: "v0",
			url: "https://developer.mozilla.org/en-US/",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "read_mdn_html_ref_link",
					description: "Read the MDN HTML reference link text.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [
						{ op: "read", target: { role: "link", name: "HTML: Markup language" }, as: "text" },
					],
					risk: "low",
					postcondition: { kind: "elementExists", target: { role: "link", name: "HTML: Markup language" } },
				},
			],
		},
	},
	// 6. example.com — read only, minimal
	{
		slug: "example-read",
		url: "https://example.com/",
		args: {},
		spec: {
			version: "v0",
			url: "https://example.com/",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "read_example_heading",
					description: "Read the page heading.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [{ op: "read", target: { role: "heading", name: "Example Domain" }, as: "text" }],
					risk: "low",
					postcondition: { kind: "textPresent", value: "Example Domain" },
				},
			],
		},
	},
	// 7. Midjourney — headless fresh browser is logged-out. Read a nav link that exists unauthenticated.
	{
		slug: "midjourney-read",
		url: "https://www.midjourney.com/explore",
		args: {},
		spec: {
			version: "v0",
			url: "https://www.midjourney.com/explore",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "read_explore_link",
					description: "Read the Explore nav link.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [{ op: "read", target: { role: "link", name: "Explore" }, as: "text" }],
					risk: "low",
				},
			],
		},
	},
	// 8. coey.dev/projects — personal site with known cmd-k search
	{
		slug: "coey-projects-search",
		url: "https://coey.dev/projects",
		args: { query: "unsurf" },
		spec: {
			version: "v0",
			url: "https://coey.dev/projects",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "open_search",
					description: "Open the cmd-K search palette.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [{ op: "click", target: { role: "button", name: "Open search (⌘K)" } }],
					risk: "medium",
				},
			],
		},
	},
	// 9. jordancoeyman.com — personal site static
	{
		slug: "jordancoeyman-read",
		url: "https://jordancoeyman.com/",
		args: {},
		spec: {
			version: "v0",
			url: "https://jordancoeyman.com/",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "read_home_heading",
					description: "Read the home heading.",
					inputSchema: { type: "object", properties: { _void: { type: "string" } } },
					dsl: [{ op: "read", target: { role: "heading", name: "Jordan Coeyman" }, as: "text" }],
					risk: "low",
				},
			],
		},
	},
	// 10. GitHub login (DO NOT SUBMIT) — tests risk:high HITL gate + does not submit
	{
		slug: "github-login-fill-only",
		url: "https://github.com/login",
		args: { user: "exp-003-test" },
		spec: {
			version: "v0",
			url: "https://github.com/login",
			fingerprint: "sha256:hand-written",
			fingerprintStrategy: "manual",
			synthesizedAt: new Date().toISOString(),
			synthesizer: { name: "hand-written", model: "none", promptHash: "sha256:0" },
			tools: [
				{
					name: "fill_username",
					description: "Fill the username field (DO NOT SUBMIT).",
					inputSchema: { type: "object", properties: { user: { type: "string" } }, required: ["user"] },
					dsl: [{ op: "fill", target: { role: "textbox", name: "Username or email address" }, value: "{{user}}" }],
					risk: "medium",
				},
			],
		},
	},
];
