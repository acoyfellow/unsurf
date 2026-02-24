/**
 * React Router loader — use unsurf-generated typed clients in
 * React Router v7 loaders running on Cloudflare Workers.
 *
 * This demonstrates the full flow:
 *   1. Scout discovers API endpoints (done once, cached in gallery)
 *   2. generateClient() produces typed fetch functions
 *   3. Those functions run inside React Router loaders on the edge
 *
 * File layout for a React Router + Cloudflare app:
 *   workers/app.ts     — Worker entry point
 *   app/routes/home.tsx — Route with loader
 *   app/.client/api.ts  — Generated client (output of generateClient)
 *
 * This file is embedded in the docs and tested in CI.
 */
import { generateClient } from "unsurf";

// ---- Part 1: Generate the typed client from a scouted spec ----
// In practice, you'd run `scout()` first or pull from the gallery.
// Here we inline the spec for clarity.

const spec = {
	openapi: "3.1.0",
	info: { title: "Weather API" },
	servers: [{ url: "https://api.weather.example.com" }],
	paths: {
		"/forecast/{city}": {
			get: {
				operationId: "getForecast",
				parameters: [
					{ name: "city", in: "path", required: true, schema: { type: "string" } },
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										city: { type: "string" },
										tempF: { type: "number" },
										condition: { type: "string" },
										humidity: { type: "number" },
									},
									required: ["city", "tempF", "condition", "humidity"],
								},
							},
						},
					},
				},
			},
		},
		"/alerts": {
			get: {
				operationId: "getAlerts",
				parameters: [
					{ name: "region", in: "query", required: true, schema: { type: "string" } },
				],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "array",
									items: {
										type: "object",
										properties: {
											severity: { type: "string", enum: ["low", "medium", "high"] },
											message: { type: "string" },
											expires: { type: "string", format: "date-time" },
										},
										required: ["severity", "message", "expires"],
									},
								},
							},
						},
					},
				},
			},
		},
	},
};

const client = generateClient(spec);
console.log("=== Generated client (save as app/.server/weather-api.ts) ===\n");
console.log(client);

// ---- Part 2: How you'd use it in a React Router loader ----
// This is pseudocode showing the React Router integration pattern.
// The generated client functions run server-side in the Worker.

const loaderExample = `
// app/routes/weather.tsx
import type { Route } from "./+types/weather";
import { getForecast, getAlerts } from "../.server/weather-api";

// This loader runs on the Cloudflare Worker — never shipped to the browser.
// The generated fetch functions from unsurf execute at the edge,
// close to both the user and the upstream API.
export async function loader({ params, context }: Route.LoaderArgs) {
  const city = params.city ?? "seattle";

  // Both calls use the typed functions unsurf generated.
  // getForecast returns { city: string; tempF: number; condition: string; humidity: number }
  // getAlerts returns { severity: "low"|"medium"|"high"; message: string; expires: string }[]
  const [forecast, alerts] = await Promise.all([
    getForecast(city),
    getAlerts({ region: city }),
  ]);

  return { forecast, alerts };
}

// Component receives fully typed loaderData — no manual type assertions.
export default function Weather({ loaderData }: Route.ComponentProps) {
  const { forecast, alerts } = loaderData;
  return (
    <div>
      <h1>{forecast.city}: {forecast.tempF}°F, {forecast.condition}</h1>
      <p>Humidity: {forecast.humidity}%</p>
      {alerts.length > 0 && (
        <ul>
          {alerts.map((a, i) => (
            <li key={i} data-severity={a.severity}>{a.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
`;

console.log("=== React Router loader usage ===\n");
console.log(loaderExample);

// ---- Part 3: workers/app.ts entry point ----

const entryExample = `
// workers/app.ts — Cloudflare Worker entry point for React Router
import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
`;

console.log("=== workers/app.ts entry ===\n");
console.log(entryExample);
