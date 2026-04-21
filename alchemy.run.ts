import alchemy, { type StateStoreType } from "alchemy";
import type { Binding } from "alchemy/cloudflare";
import {
	Ai,
	BrowserRendering,
	CustomDomain,
	D1Database,
	KVNamespace,
	R2Bucket,
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

const STORAGE = await R2Bucket("unsurf-storage", {
	adopt: true,
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

export const TRACE_WORKER = await Worker("unsurf-trace", {
	name: "unsurf-trace",
	entrypoint: "./src/trace-worker.ts",
	bindings: {
		STORAGE,
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
