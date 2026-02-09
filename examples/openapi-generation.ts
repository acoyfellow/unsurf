/**
 * OpenAPI generation — how unsurf turns captured endpoints into an OpenAPI 3.1 spec.
 * This file is embedded in the docs and tested in CI.
 */
import { Effect, Option } from "effect";
import {
	CapturedEndpoint,
	OpenApiGenerator,
	OpenApiGeneratorLive,
	makeOpenApiGenerator,
} from "unsurf";

// Create endpoints as the scout would capture them
const endpoints = [
	new CapturedEndpoint({
		id: "ep_1",
		siteId: "site_1",
		method: "GET",
		pathPattern: "https://api.example.com/users",
		requestSchema: Option.none(),
		responseSchema: Option.some({
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "integer" },
					name: { type: "string" },
				},
				required: ["id", "name"],
			},
		}),
		sampleCount: 3,
		firstSeenAt: "2024-01-15T10:00:00Z",
		lastSeenAt: "2024-01-15T10:05:00Z",
	}),
	new CapturedEndpoint({
		id: "ep_2",
		siteId: "site_1",
		method: "GET",
		pathPattern: "https://api.example.com/users/:id",
		requestSchema: Option.none(),
		responseSchema: Option.some({
			type: "object",
			properties: {
				id: { type: "integer" },
				name: { type: "string" },
				email: { type: "string", format: "email" },
			},
			required: ["id", "name", "email"],
		}),
		sampleCount: 1,
		firstSeenAt: "2024-01-15T10:01:00Z",
		lastSeenAt: "2024-01-15T10:01:00Z",
	}),
];

// Generate the OpenAPI spec
const generator = makeOpenApiGenerator();
const spec = Effect.runSync(generator.generate("https://api.example.com", endpoints));

console.log(JSON.stringify(spec, null, 2));
// Produces a full OpenAPI 3.1 spec with:
// - paths: /users (GET), /users/{id} (GET)
// - components.schemas with inferred types
// - servers pointing to api.example.com
