/**
 * Endpoint safety classification for agent guardrails.
 *
 * Classifies endpoints by risk level so the worker can warn or block
 * before replaying potentially destructive HTTP calls.
 */

// ==================== Types ====================

export type RiskLevel = "safe" | "moderate" | "unsafe" | "destructive";

export interface SafetyClassification {
	readonly level: RiskLevel;
	readonly reason: string;
}

// ==================== Path Patterns ====================

/**
 * Path segments that signal billing/payment endpoints.
 * Matching any of these in the URL path raises the risk to "destructive".
 */
const DESTRUCTIVE_PATH_PATTERNS = [
	/\bbilling\b/i,
	/\bpayment/i,
	/\bsubscription/i,
	/\bcharge/i,
	/\binvoice/i,
	/\brefund/i,
	/\bcheckout/i,
	/\bpurchase/i,
	/\border/i,
	/\btransaction/i,
	/\btransfer/i,
	/\bpayout/i,
];

/**
 * Path segments that signal account/admin-level mutations.
 * PUT/PATCH/POST to these are "unsafe"; DELETE is "destructive".
 */
const SENSITIVE_PATH_PATTERNS = [
	/\baccount\b/i,
	/\buser\/delete/i,
	/\bdeactivat/i,
	/\badmin\b/i,
	/\bsettings\b/i,
	/\bpassword/i,
	/\brole/i,
	/\bpermission/i,
	/\bapi[-_]?key/i,
	/\btoken/i,
	/\bsecret/i,
	/\bwebhook/i,
];

// ==================== Classification ====================

/**
 * Classify an endpoint by HTTP method and path pattern.
 *
 * Risk levels:
 * - `safe`:        GET, HEAD, OPTIONS — read-only, no side effects
 * - `moderate`:    POST to non-sensitive paths — creates data but unlikely destructive
 * - `unsafe`:      PUT/PATCH mutations, or POST to sensitive paths
 * - `destructive`: DELETE anything, or mutations to billing/payment paths
 */
export function classifyEndpoint(method: string, pathPattern: string): SafetyClassification {
	const upper = method.toUpperCase();

	// GET, HEAD, OPTIONS are always safe
	if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") {
		return { level: "safe", reason: "Read-only method" };
	}

	// DELETE is always destructive
	if (upper === "DELETE") {
		return {
			level: "destructive",
			reason: `DELETE ${pathPattern} — may permanently remove data`,
		};
	}

	// Check path against destructive patterns (billing, payments, etc.)
	for (const pattern of DESTRUCTIVE_PATH_PATTERNS) {
		if (pattern.test(pathPattern)) {
			return {
				level: "destructive",
				reason: `${upper} ${pathPattern} — matches financial/billing pattern`,
			};
		}
	}

	// Check path against sensitive patterns (account, admin, etc.)
	for (const pattern of SENSITIVE_PATH_PATTERNS) {
		if (pattern.test(pathPattern)) {
			return {
				level: "unsafe",
				reason: `${upper} ${pathPattern} — matches sensitive resource pattern`,
			};
		}
	}

	// PUT/PATCH to non-sensitive paths
	if (upper === "PUT" || upper === "PATCH") {
		return {
			level: "moderate",
			reason: `${upper} ${pathPattern} — mutates existing data`,
		};
	}

	// POST to non-sensitive paths
	return {
		level: "moderate",
		reason: `${upper} ${pathPattern} — creates or mutates data`,
	};
}

/**
 * Returns true if the risk level requires explicit confirmation.
 * `unsafe` and `destructive` endpoints are blocked unless the caller
 * passes `confirmUnsafe: true`.
 */
export function requiresConfirmation(level: RiskLevel): boolean {
	return level === "unsafe" || level === "destructive";
}
