import alchemy from "alchemy";
import { BrowserRendering, D1Database, R2Bucket, Worker } from "alchemy/cloudflare";

const app = await alchemy("unsurf", {
	password: process.env.ALCHEMY_PASSWORD || "dev-password",
});

const DB = await D1Database("unsurf-db", {
	migrationsDir: "./migrations",
});

const STORAGE = await R2Bucket("unsurf-storage");

const BROWSER = BrowserRendering();

export const WORKER = await Worker("unsurf", {
	name: "unsurf",
	entrypoint: "./src/index.ts",
	bindings: { DB, STORAGE, BROWSER },
	url: true,
	adopt: true,
});

await app.finalize();
