/**
 * Local synth worker. Run with: wrangler dev --port 8787
 * POST /run { model, system, user, schema } -> Workers AI inference with JSON schema response format
 * POST /chat { model, messages, schema? } -> raw messages API
 */
export default {
	async fetch(req: Request, env: { AI: Ai }): Promise<Response> {
		const url = new URL(req.url);
		if (req.method !== "POST") return new Response("POST only", { status: 405 });

		try {
			const body = (await req.json()) as any;

			if (url.pathname === "/run") {
				const { model, system, user, schema, max_tokens = 4096, temperature = 0.2 } = body;
				const t0 = Date.now();
				const result: any = await env.AI.run(model, {
					messages: [
						{ role: "system", content: system },
						{ role: "user", content: user },
					],
					max_tokens,
					temperature,
					...(schema ? { response_format: { type: "json_schema", json_schema: schema } } : {}),
				});
				return Response.json({
					latency_ms: Date.now() - t0,
					model,
					result,
				});
			}

			if (url.pathname === "/chat") {
				const { model, messages, schema, max_tokens = 4096, temperature = 0.2 } = body;
				const t0 = Date.now();
				const result: any = await env.AI.run(model, {
					messages,
					max_tokens,
					temperature,
					...(schema ? { response_format: { type: "json_schema", json_schema: schema } } : {}),
				});
				return Response.json({
					latency_ms: Date.now() - t0,
					model,
					result,
				});
			}

			return new Response(JSON.stringify({ error: "unknown path" }), { status: 404 });
		} catch (e: any) {
			return Response.json({ error: String(e?.message ?? e), stack: e?.stack }, { status: 500 });
		}
	},
};
