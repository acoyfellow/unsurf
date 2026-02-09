import alchemy, { type StateStoreType } from "alchemy";
import { BrowserRendering, D1Database, R2Bucket, Worker } from "alchemy/cloudflare";
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

export const WORKER = await Worker("unsurf", {
	name: "unsurf",
	entrypoint: "./src/cf-worker.ts",
	bindings: { DB, STORAGE, BROWSER },
	compatibility: "node",
	url: true,
	adopt: true,
});

await app.finalize();
