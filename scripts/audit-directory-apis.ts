#!/usr/bin/env bun

const UNSURF_URL = process.env.UNSURF_URL ?? "https://unsurf-api.coey.dev";

interface ApiTestResult {
	domain: string;
	status: "WORKING" | "BROKEN" | "BLOCKED" | "TIMEOUT" | "ERROR";
	httpStatus?: number;
	error?: string;
	responseTimeMs: number;
	endpointTested?: string;
	responsePreview?: string;
}

const results: ApiTestResult[] = [];

async function testApi(domain: string): Promise<void> {
	const start = Date.now();

	try {
		console.log(`\n🔍 Testing ${domain}...`);

		// First, get the fingerprint to see what endpoints are available
		const fpRes = await fetch(`${UNSURF_URL}/d/${domain}`);

		if (!fpRes.ok) {
			const duration = Date.now() - start;
			results.push({
				domain,
				status: "ERROR",
				httpStatus: fpRes.status,
				error: `Failed to get fingerprint: ${fpRes.status}`,
				responseTimeMs: duration,
			});
			console.log(`  ❌ Failed to get fingerprint: ${fpRes.status}`);
			return;
		}

		const fingerprint = await fpRes.json();

		// Try to invoke the first GET endpoint
		let testEndpoint = null;

		// Look for a simple GET endpoint
		if (fingerprint.capabilities) {
			for (const [cap, data] of Object.entries(
				fingerprint.capabilities as Record<
					string,
					{ endpoints?: Array<{ method: string; path: string }> }
				>,
			)) {
				if (data.endpoints) {
					const getEndpoint = data.endpoints.find((e) => e.method === "GET");
					if (getEndpoint) {
						testEndpoint = getEndpoint;
						break;
					}
				}
			}
		}

		if (!testEndpoint) {
			const duration = Date.now() - start;
			results.push({
				domain,
				status: "ERROR",
				error: "No GET endpoint found in fingerprint",
				responseTimeMs: duration,
			});
			console.log(`  ⚠️  No GET endpoint found`);
			return;
		}

		console.log(`  📍 Testing ${testEndpoint.method} ${testEndpoint.path}`);

		// Try to invoke the endpoint
		const invokeRes = await fetch(`${UNSURF_URL}/d/invoke`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				domain,
				method: testEndpoint.method,
				path: testEndpoint.path,
			}),
		});

		const duration = Date.now() - start;
		const invokeData = await invokeRes.json();

		// Check for specific error patterns
		if (
			invokeRes.status === 403 ||
			invokeData.body?.includes("robot") ||
			invokeData.body?.includes("blocked")
		) {
			results.push({
				domain,
				status: "BLOCKED",
				httpStatus: invokeRes.status,
				error: "API blocks automated requests",
				responseTimeMs: duration,
				endpointTested: testEndpoint.path,
				responsePreview:
					typeof invokeData.body === "string"
						? invokeData.body.slice(0, 200)
						: JSON.stringify(invokeData).slice(0, 200),
			});
			console.log(`  🚫 BLOCKED - API rejects automation`);
			return;
		}

		if (invokeRes.ok) {
			results.push({
				domain,
				status: "WORKING",
				httpStatus: invokeRes.status,
				responseTimeMs: duration,
				endpointTested: testEndpoint.path,
				responsePreview:
					typeof invokeData.body === "string" ? invokeData.body.slice(0, 100) : "JSON response",
			});
			console.log(`  ✅ WORKING (${duration}ms)`);
		} else {
			results.push({
				domain,
				status: "BROKEN",
				httpStatus: invokeRes.status,
				error: `HTTP ${invokeRes.status}: ${JSON.stringify(invokeData).slice(0, 100)}`,
				responseTimeMs: duration,
				endpointTested: testEndpoint.path,
			});
			console.log(`  ❌ BROKEN - HTTP ${invokeRes.status}`);
		}
	} catch (e) {
		const duration = Date.now() - start;
		const errorMsg = e instanceof Error ? e.message : String(e);

		if (errorMsg.includes("timeout")) {
			results.push({
				domain,
				status: "TIMEOUT",
				error: errorMsg,
				responseTimeMs: duration,
			});
			console.log(`  ⏱️  TIMEOUT`);
		} else {
			results.push({
				domain,
				status: "ERROR",
				error: errorMsg,
				responseTimeMs: duration,
			});
			console.log(`  💥 ERROR: ${errorMsg.slice(0, 100)}`);
		}
	}
}

async function getAllDomains(): Promise<string[]> {
	console.log("📚 Fetching all domains from directory...\n");

	const domains: string[] = [];
	let offset = 0;
	const limit = 50;

	while (true) {
		const res = await fetch(`${UNSURF_URL}/d/?offset=${offset}&limit=${limit}`);
		if (!res.ok) {
			console.error(`Failed to fetch directory: ${res.status}`);
			break;
		}

		const data = await res.json();
		if (!data.fingerprints || data.fingerprints.length === 0) break;

		for (const fp of data.fingerprints) {
			if (fp.domain) domains.push(fp.domain);
		}

		if (data.fingerprints.length < limit) break;
		offset += limit;
	}

	console.log(`Found ${domains.length} domains\n`);
	return domains;
}

async function runDirectoryAudit(): Promise<void> {
	console.log("🔍 DIRECTORY API AUDIT");
	console.log(`Target: ${UNSURF_URL}\n`);
	console.log("=".repeat(60));

	const domains = await getAllDomains();

	if (domains.length === 0) {
		console.log("\n❌ No domains found in directory");
		return;
	}

	console.log(`\n🧪 Testing ${domains.length} APIs...\n`);

	for (const domain of domains) {
		await testApi(domain);
		await new Promise((r) => setTimeout(r, 1000));
	}

	console.log("\n" + "=".repeat(60));
	console.log("📊 AUDIT SUMMARY\n");

	const working = results.filter((r) => r.status === "WORKING").length;
	const blocked = results.filter((r) => r.status === "BLOCKED").length;
	const broken = results.filter((r) => r.status === "BROKEN").length;
	const timeout = results.filter((r) => r.status === "TIMEOUT").length;
	const error = results.filter((r) => r.status === "ERROR").length;

	console.log(`Total APIs: ${results.length}`);
	console.log(`✅ WORKING: ${working}`);
	console.log(`🚫 BLOCKED: ${blocked}`);
	console.log(`❌ BROKEN: ${broken}`);
	console.log(`⏱️  TIMEOUT: ${timeout}`);
	console.log(`💥 ERROR: ${error}`);
	console.log(`\nHealth Rate: ${Math.round((working / results.length) * 100)}%`);

	if (blocked > 0 || broken > 0) {
		console.log("\n🗑️  RECOMMENDED FOR REMOVAL:");
		results
			.filter((r) => r.status === "BLOCKED" || r.status === "BROKEN")
			.forEach((r) => {
				console.log(`  - ${r.domain} (${r.status})${r.error ? `: ${r.error.slice(0, 80)}` : ""}`);
			});
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outputPath = `.sisyphus/evidence/directory-api-audit-${timestamp}.json`;
	await Bun.write(
		outputPath,
		JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				url: UNSURF_URL,
				summary: {
					total: results.length,
					working,
					blocked,
					broken,
					timeout,
					error,
					healthRate: Math.round((working / results.length) * 100),
				},
				results,
			},
			null,
			2,
		),
	);
	console.log(`\n💾 Detailed results saved to: ${outputPath}`);

	if (blocked > 0 || broken > 0) {
		console.log("\n⚠️  To remove broken APIs from directory:");
		console.log("   curl -X DELETE https://unsurf-api.coey.dev/d/<domain>");
	}
}

runDirectoryAudit().catch(console.error);
