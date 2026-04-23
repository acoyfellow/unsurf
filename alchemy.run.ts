import alchemy, { type StateStoreType } from "alchemy";
import type { Binding } from "alchemy/cloudflare";
import {
	Ai,
	BrowserRendering,
	CustomDomain,
	D1Database,
	KVNamespace,
	R2Bucket,
	RateLimit,
	VectorizeIndex,
	Worker,
} from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";

const stateStore: StateStoreType | undefined = process.env.ALCHEMY_STATE_TOKEN
	? (scope) => new CloudflareStateStore(scope)
	: undefined;

const app = await alchemy("unsurf", {
	password: process.env.ALCHEMY_PASSWORD || "dev-password",
	stage: process.env.ALCHEMY_STAGE || "production",
	...(stateStore ? { stateStore } : {}),
});

const DB = await D1Database("unsurf-db", {
	migrationsDir: "./migrations",
	adopt: true,
});

// Bundles are write-once, read-for-a-while. 90-day TTL keeps costs bounded
// and matches the retention we promise in docs. `trace/` prefix isolates
// the skill's objects from anything else the main worker writes.
const STORAGE = await R2Bucket("unsurf-storage", {
	adopt: true,
	lifecycle: [
		{
			id: "trace-bundles-90d",
			conditions: { prefix: "trace/" },
			enabled: true,
			deleteObjectsTransition: {
				condition: { type: "Age", maxAge: 90 * 24 * 60 * 60 },
			},
			storageClassTransitions: [
				{
					condition: { type: "Age", maxAge: 30 * 24 * 60 * 60 },
					storageClass: "InfrequentAccess",
				},
			],
		},
	],
});

const BROWSER = BrowserRendering();

const CACHE = await KVNamespace("unsurf-gallery-cache", {
	adopt: true,
});

// Vectorize index for semantic search + capability classification
const VECTORS = await VectorizeIndex("unsurf-vectors", {
	dimensions: 768,
	metric: "cosine",
	adopt: true,
});

const AI = Ai();

const bindings: Record<string, Binding> = {
	DB,
	STORAGE,
	BROWSER,
	CACHE,
	VECTORS,
	AI,
};

// Optional: pass Anthropic API key for LLM-guided scout
if (process.env.ANTHROPIC_API_KEY) {
	bindings.ANTHROPIC_API_KEY = alchemy.secret(process.env.ANTHROPIC_API_KEY);
}

export const WORKER = await Worker("unsurf", {
	name: "unsurf",
	entrypoint: "./src/cf-worker.ts",
	bindings,
	compatibility: "node",
	url: true,
	adopt: true,
});

// Custom domain for the API worker
await CustomDomain("unsurf-api-domain", {
	name: "unsurf-api.coey.dev",
	workerName: WORKER.name,
	adopt: true,
});

// ==================== trace viewer + ingest ====================
//
// Serves trace.coey.dev/r/:id (viewer) and /upload (ingest) for the `record`
// skill. v0.0.1 uses one Worker for both; split when there's >1 upload client.
// Required env vars at deploy time:
//   TRACE_SIGNING_KEY   32-byte hex (generate: openssl rand -hex 32)
//   TRACE_INGEST_TOKEN  random bearer string (generate: openssl rand -hex 32)

const traceSigningKey = process.env.TRACE_SIGNING_KEY;
const traceIngestToken = process.env.TRACE_INGEST_TOKEN;

if (!traceSigningKey || !traceIngestToken) {
	console.warn(
		"[unsurf-trace] TRACE_SIGNING_KEY and/or TRACE_INGEST_TOKEN missing; " +
			"using dev defaults. Generate real values with `openssl rand -hex 32` " +
			"before production deploys.",
	);
}

// KV namespace keyed by SHA-256(token) for per-user ingest credentials.
// Value shape: { owner, scope, createdAt, revokedAt?, quotaPerDay? }.
// Legacy TRACE_INGEST_TOKEN still authenticates as a fallback to preserve
// existing callers during migration.
const TRACE_TOKENS = await KVNamespace("unsurf-trace-tokens", {
	adopt: true,
});

// 120 uploads/minute per token hash is 2/s sustained — generous for real
// use, low enough to cap damage if a token leaks. Namespace id 1001 is
// arbitrary; must be stable across deploys.
const TRACE_INGEST_RATE_LIMIT = RateLimit({
	namespace_id: 1001,
	simple: { limit: 120, period: 60 },
});

export const TRACE_WORKER = await Worker("unsurf-trace", {
	name: "unsurf-trace",
	entrypoint: "./src/trace-worker.ts",
	bindings: {
		STORAGE,
		TRACE_TOKENS,
		TRACE_INGEST_RATE_LIMIT,
		TRACE_SIGNING_KEY: alchemy.secret(
			traceSigningKey || "dev-signing-key-replace-before-real-use-00000000",
		),
		TRACE_INGEST_TOKEN: alchemy.secret(
			traceIngestToken || "dev-ingest-token-replace-before-real-use",
		),
	},
	compatibility: "node",
	url: true,
	adopt: true,
});

await CustomDomain("unsurf-trace-domain", {
	name: "trace.coey.dev",
	workerName: TRACE_WORKER.name,
	adopt: true,
});

await app.finalize();
