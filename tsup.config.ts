import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: true,
	splitting: false,
	sourcemap: true,
	clean: true,
	target: "esnext",
	external: [
		"effect",
		"@effect/platform",
		"@effect/schema",
		"drizzle-orm",
		"@cloudflare/puppeteer",
		"@modelcontextprotocol/sdk",
		"zod",
	],
});
