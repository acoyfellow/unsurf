#!/usr/bin/env node

/**
 * unsurf CLI — query the unsurf directory from the command line
 *
 * Usage:
 *   unsurf search <query>          Search the API directory
 *   unsurf lookup <domain>         Get fingerprint for a domain
 *   unsurf publish <siteId>        Publish a scouted site to the directory
 */

const API_BASE = "https://unsurf-api.coey.dev";

// ==================== Helpers ====================

async function api(path: string, options?: RequestInit): Promise<unknown> {
	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});

	if (!res.ok) {
		const body = await res.text();
		let message: string;
		try {
			message = (JSON.parse(body) as { error?: string }).error ?? body;
		} catch {
			message = body;
		}
		throw new Error(`API error (${res.status}): ${message}`);
	}

	return res.json();
}

function printJson(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

function usage(): never {
	console.log(`unsurf — Turn any website into a typed API

Usage:
  unsurf search <query>          Search the API directory
  unsurf lookup <domain>         Get fingerprint for a domain
  unsurf publish <siteId>        Publish a scouted site to the directory

Examples:
  unsurf search "payment processing"
  unsurf lookup stripe.com
  unsurf publish site_abc123`);
	process.exit(0);
}

// ==================== Commands ====================

async function searchCommand(query: string): Promise<void> {
	const data = await api(`/search?q=${encodeURIComponent(query)}`);
	const results = (data as { results: Array<{ domain: string; match: string; capability: string; confidence: number; specUrl: string }> }).results;

	if (!results || results.length === 0) {
		console.log("No results found.");
		return;
	}

	console.log(`Found ${results.length} result(s):\n`);
	for (const r of results) {
		console.log(`  ${r.domain}`);
		console.log(`    Match:      ${r.match}`);
		console.log(`    Capability: ${r.capability}`);
		console.log(`    Confidence: ${(r.confidence * 100).toFixed(1)}%`);
		console.log(`    Spec:       ${API_BASE}${r.specUrl}`);
		console.log();
	}
}

async function lookupCommand(domain: string): Promise<void> {
	const fp = (await api(`/d/${encodeURIComponent(domain)}`)) as {
		domain: string;
		url: string;
		endpoints: number;
		capabilities: string[];
		methods: Record<string, number>;
		auth: string;
		confidence: number;
		version: number;
		specUrl: string;
	};

	console.log(`Fingerprint for ${fp.domain}\n`);
	console.log(`  URL:          ${fp.url}`);
	console.log(`  Endpoints:    ${fp.endpoints}`);
	console.log(`  Capabilities: ${fp.capabilities.join(", ")}`);
	console.log(`  Methods:      ${Object.entries(fp.methods).map(([m, c]) => `${m}:${c}`).join(", ")}`);
	console.log(`  Auth:         ${fp.auth}`);
	console.log(`  Confidence:   ${(fp.confidence * 100).toFixed(1)}%`);
	console.log(`  Version:      ${fp.version}`);
	console.log(`  Spec:         ${API_BASE}${fp.specUrl}`);
}

async function publishCommand(siteId: string): Promise<void> {
	const fp = await api("/d/publish", {
		method: "POST",
		body: JSON.stringify({ siteId }),
	});

	console.log("Published successfully!\n");
	printJson(fp);
}

// ==================== Main ====================

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		usage();
	}

	try {
		switch (command) {
			case "search": {
				const query = args.slice(1).join(" ");
				if (!query) {
					console.error("Error: search requires a query\n  Usage: unsurf search <query>");
					process.exit(1);
				}
				await searchCommand(query);
				break;
			}

			case "lookup": {
				const domain = args[1];
				if (!domain) {
					console.error("Error: lookup requires a domain\n  Usage: unsurf lookup <domain>");
					process.exit(1);
				}
				await lookupCommand(domain);
				break;
			}

			case "publish": {
				const siteId = args[1];
				if (!siteId) {
					console.error("Error: publish requires a siteId\n  Usage: unsurf publish <siteId>");
					process.exit(1);
				}
				await publishCommand(siteId);
				break;
			}

			default:
				console.error(`Unknown command: ${command}`);
				usage();
		}
	} catch (err) {
		console.error((err as Error).message);
		process.exit(1);
	}
}

main();
