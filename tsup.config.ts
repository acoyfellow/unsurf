import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		cli: "src/cli.ts",
		"local-mcp": "src/local-mcp.ts",
		"skills/record": "src/skills/record/index.ts",
		"skills/observe-video": "src/skills/observe-video/index.ts",
		"skills/loop": "src/skills/loop/index.ts",
		investigate: "src/investigate/index.ts",
	},
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
