/**
 * Schema inference — how unsurf turns JSON responses into JSON Schema.
 * This file is embedded in the docs and tested in CI.
 */
import { Effect } from "effect";
import { makeSchemaInferrer } from "unsurf";

const inferrer = makeSchemaInferrer();

// Infer schema from a single API response
const schema = Effect.runSync(
	inferrer.infer([
		{
			id: 1,
			name: "Alice",
			email: "alice@example.com",
			createdAt: "2024-01-15T10:30:00Z",
		},
	]),
);

console.log(JSON.stringify(schema, null, 2));
// {
//   "type": "object",
//   "properties": {
//     "id": { "type": "integer" },
//     "name": { "type": "string" },
//     "email": { "type": "string", "format": "email" },
//     "createdAt": { "type": "string", "format": "date-time" }
//   },
//   "required": ["id", "name", "email", "createdAt"]
// }

// Merge schemas from multiple responses (handles optional fields)
const merged = Effect.runSync(
	inferrer.infer([
		{ id: 1, name: "Alice", email: "alice@example.com" },
		{ id: 2, name: "Bob", avatar: "https://example.com/bob.png" },
	]),
);

console.log(JSON.stringify(merged, null, 2));
// "email" and "avatar" become optional (not in `required`)
// because each appears in only one sample
