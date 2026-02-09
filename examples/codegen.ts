/**
 * Client codegen — generate a typed TypeScript client from an OpenAPI spec.
 * This file is embedded in the docs and tested in CI.
 */
import { generateClient } from "unsurf";

// An OpenAPI spec (as returned by the scout tool)
const spec = {
	openapi: "3.1.0",
	info: { title: "Example API", version: "1.0.0" },
	servers: [{ url: "https://api.example.com" }],
	paths: {
		"/users": {
			get: {
				operationId: "getUsers",
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: {
									type: "array",
									items: { $ref: "#/components/schemas/User" },
								},
							},
						},
					},
				},
			},
		},
		"/users/{id}": {
			get: {
				operationId: "getUserById",
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
				responses: {
					"200": {
						description: "OK",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/User" },
							},
						},
					},
				},
			},
		},
	},
	components: {
		schemas: {
			User: {
				type: "object",
				properties: {
					id: { type: "integer" },
					name: { type: "string" },
					email: { type: "string", format: "email" },
				},
				required: ["id", "name", "email"],
			},
		},
	},
};

// Generate a typed fetch client
const client = generateClient(spec);
console.log(client);
// Produces a TypeScript string with typed fetch wrappers:
// - getUsers(): Promise<User[]>
// - getUserById(id: string): Promise<User>
