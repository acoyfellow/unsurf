#!/usr/bin/env bun

const UNSURF_URL = process.env.UNSURF_URL ?? "https://unsurf-api.coey.dev";

interface AuditResult {
	endpoint: string;
	method: string;
	status: "PASS" | "FAIL" | "SKIP";
	statusCode?: number;
	error?: string;
	durationMs: number;
	responsePreview?: unknown;
}

const results: AuditResult[] = [];

async function audit(
	name: string,
	method: string,
	path: string,
	body?: unknown,
	skipIf?: () => boolean,
): Promise<void> {
	if (skipIf?.()) {
		results.push({
			endpoint: name,
			method,
			status: "SKIP",
			durationMs: 0,
		});
		return;
	}

	const start = Date.now();
	try {
		const init: RequestInit = {
			method,
			headers: { "Content-Type": "application/json" },
		};
		if (body) {
			init.body = JSON.stringify(body);
		}

		const res = await fetch(`${UNSURF_URL}${path}`, init);
		const durationMs = Date.now() - start;

		let responsePreview: unknown;
		try {
			responsePreview = await res.json();
		} catch {
			responsePreview = await res.text();
		}

		// Determine pass/fail based on expected status codes
		const isPass = res.ok || (path.includes("/d/") && res.status === 404); // 404 for non-existent directory items is expected

		results.push({
			endpoint: name,
			method,
			status: isPass ? "PASS" : "FAIL",
			statusCode: res.status,
			durationMs,
			responsePreview:
				typeof responsePreview === "object"
					? responsePreview
					: String(responsePreview).slice(0, 200),
		});

		console.log(`${isPass ? "✅" : "❌"} ${method} ${path} - ${res.status} (${durationMs}ms)`);
	} catch (e) {
		const durationMs = Date.now() - start;
		results.push({
			endpoint: name,
			method,
			status: "FAIL",
			error: e instanceof Error ? e.message : String(e),
			durationMs,
		});
		console.log(`❌ ${method} ${path} - ERROR: ${e instanceof Error ? e.message : String(e)}`);
	}
}

async function runAudit(): Promise<void> {
	console.log(`🔍 Auditing unsurf APIs at ${UNSURF_URL}\n`);
	console.log("=".repeat(60));

	// ==================== DISCOVERY ====================
	console.log("\n📋 API Discovery");
	await audit("Root API info", "GET", "/");
	await audit("API endpoint", "GET", "/api");

	// ==================== TOOLS (Core Functionality) ====================
	console.log("\n🔧 Core Tools");

	// Scout - test with a simple public API
	await audit("Tool: Scout (jsonplaceholder)", "POST", "/tools/scout", {
		url: "https://jsonplaceholder.typicode.com",
		task: "find all API endpoints",
		publish: false,
	});

	// Worker - depends on scout success
	// We'll test with a known gallery entry if possible
	await audit("Tool: Worker (with test pathId)", "POST", "/tools/worker", {
		pathId: "path_test_123",
		data: {},
	});

	// Heal - test with invalid path
	await audit("Tool: Heal (invalid pathId)", "POST", "/tools/heal", {
		pathId: "path_nonexistent_123",
		error: "test error",
	});

	// ==================== GALLERY ====================
	console.log("\n🖼️  Gallery");
	await audit("Gallery: Search", "GET", "/gallery?q=test");
	await audit("Gallery: Search by domain", "GET", "/gallery?domain=api.github.com");
	await audit("Gallery: Get spec (invalid)", "GET", "/gallery/invalid-id/spec");

	// ==================== DIRECTORY ====================
	console.log("\n📚 Directory");

	// List all
	await audit("Directory: List all", "GET", "/d/");
	await audit("Directory: List with pagination", "GET", "/d/?offset=0&limit=5");

	// Fingerprint - test with a known domain or expect 404
	await audit("Directory: Get fingerprint (github)", "GET", "/d/api.github.com");
	await audit("Directory: Get fingerprint (nonexistent)", "GET", "/d/nonexistent.example.com");

	// Spec
	await audit("Directory: Get spec (github)", "GET", "/d/api.github.com/spec");

	// Capability slice
	await audit("Directory: Capability slice", "GET", "/d/api.github.com/crud");

	// Single endpoint
	await audit("Directory: Single endpoint", "GET", "/d/api.github.com/GET/repos/:owner/:repo");

	// Publish - requires auth/siteId
	await audit("Directory: Publish (invalid siteId)", "POST", "/d/publish", {
		siteId: "invalid_site_id",
	});

	// Delete - requires existing domain
	await audit("Directory: Delete (nonexistent)", "DELETE", "/d/nonexistent.example.com");

	// ==================== SEARCH ====================
	console.log("\n🔍 Search");
	await audit("Search: Query", "GET", "/search?q=github");
	await audit("Search: Query with limit", "GET", "/search?q=api&limit=5");
	await audit("Search: Missing query", "GET", "/search");

	// ==================== INVOKE ====================
	console.log("\n⚡ Invoke");
	await audit("Invoke: Test API call", "POST", "/d/invoke", {
		domain: "jsonplaceholder.typicode.com",
		method: "GET",
		path: "/posts/1",
	});

	// ==================== VALIDATE ====================
	console.log("\n✅ Validate");
	await audit("Validate: Endpoints", "POST", "/d/validate", {
		domain: "example.com",
		endpoints: [
			{ method: "GET", path: "/api/users" },
			{ method: "POST", path: "/api/users" },
		],
	});

	// ==================== MCP ====================
	console.log("\n🤖 MCP Endpoint");
	// MCP is a POST endpoint that expects specific MCP protocol messages
	await audit("MCP: Initialize", "POST", "/mcp", {
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "audit-script", version: "1.0.0" },
		},
	});

	// ==================== ERROR CASES ====================
	console.log("\n❌ Error Handling");
	await audit("404: Not found", "GET", "/nonexistent-path");
	await audit("405: Method not allowed", "POST", "/search?q=test"); // Search is GET only
	await audit("400: Bad request", "POST", "/tools/scout", {}); // Missing required fields

	// ==================== CORS ====================
	console.log("\n🌐 CORS");
	const corsRes = await fetch(`${UNSURF_URL}/`, {
		method: "OPTIONS",
		headers: {
			Origin: "https://example.com",
			"Access-Control-Request-Method": "POST",
		},
	});
	results.push({
		endpoint: "CORS Preflight",
		method: "OPTIONS",
		status: corsRes.ok ? "PASS" : "FAIL",
		statusCode: corsRes.status,
		durationMs: 0,
	});
	console.log(`${corsRes.ok ? "✅" : "❌"} OPTIONS / (CORS preflight)`);

	console.log(`\n${"=".repeat(60)}`);
	console.log("📊 AUDIT SUMMARY\n");

	const passed = results.filter((r) => r.status === "PASS").length;
	const failed = results.filter((r) => r.status === "FAIL").length;
	const skipped = results.filter((r) => r.status === "SKIP").length;
	const total = results.length;

	console.log(`Total: ${total}`);
	console.log(`✅ PASS: ${passed}`);
	console.log(`❌ FAIL: ${failed}`);
	console.log(`⏭️  SKIP: ${skipped}`);
	console.log(`\nSuccess Rate: ${Math.round((passed / total) * 100)}%`);

	if (failed > 0) {
		console.log("\n❌ FAILED ENDPOINTS:");
		for (const r of results.filter((r) => r.status === "FAIL")) {
			console.log(`  - ${r.method} ${r.endpoint}: ${r.error || r.statusCode}`);
		}
	}

	// Save detailed results
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outputPath = `.sisyphus/evidence/api-audit-${timestamp}.json`;
	await Bun.write(
		outputPath,
		JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				url: UNSURF_URL,
				summary: {
					total,
					passed,
					failed,
					skipped,
					successRate: Math.round((passed / total) * 100),
				},
				results,
			},
			null,
			2,
		),
	);
	console.log(`\n💾 Detailed results saved to: ${outputPath}`);
}

runAudit().catch(console.error);
