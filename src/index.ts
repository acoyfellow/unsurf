/**
 * unsurf — Turn any website into a typed API
 *
 * Cloudflare Worker entry point
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/") {
			return Response.json({
				name: "unsurf",
				version: "0.0.1",
				description: "Turn any website into a typed API",
				tools: ["scout", "worker", "heal"],
				docs: "/docs",
			});
		}

		return new Response("Not found", { status: 404 });
	},
};

interface Env {
	DB: D1Database;
	STORAGE: R2Bucket;
	BROWSER: Fetcher;
}
