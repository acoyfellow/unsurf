import alchemy, { type StateStoreType } from "alchemy";
import type { Binding } from "alchemy/cloudflare";
import {
	BrowserRendering,
	CustomDomain,
	D1Database,
	KVNamespace,
	R2Bucket,
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

const bindings: Record<string, Binding> = { DB, STORAGE, BROWSER, CACHE };

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

await app.finalize();
