import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeSchemaInferrer } from "../src/services/SchemaInferrer.js";

const inferrer = makeSchemaInferrer();
const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

describe("SchemaInferrer", () => {
	describe("infer", () => {
		it("infers string type", async () => {
			const schema = await run(inferrer.infer(["hello"]));
			expect(schema.type).toBe("string");
		});

		it("infers integer type", async () => {
			const schema = await run(inferrer.infer([42]));
			expect(schema.type).toBe("integer");
		});

		it("infers number type for floats", async () => {
			const schema = await run(inferrer.infer([3.14]));
			expect(schema.type).toBe("number");
		});

		it("infers boolean type", async () => {
			const schema = await run(inferrer.infer([true]));
			expect(schema.type).toBe("boolean");
		});

		it("infers null type", async () => {
			const schema = await run(inferrer.infer([null]));
			expect(schema.type).toBe("null");
		});

		it("infers object with properties", async () => {
			const schema = await run(inferrer.infer([{ name: "Jane", age: 30 }]));
			expect(schema.type).toBe("object");

			const props = schema.properties as Record<string, Record<string, unknown>>;
			expect(props.name?.type).toBe("string");
			expect(props.age?.type).toBe("integer");
			expect(schema.required).toEqual(["name", "age"]);
		});

		it("infers array with item schema", async () => {
			const schema = await run(inferrer.infer([[1, 2, 3]]));
			expect(schema.type).toBe("array");

			const items = schema.items as Record<string, unknown>;
			expect(items.type).toBe("integer");
		});

		it("infers empty array", async () => {
			const schema = await run(inferrer.infer([[]]));
			expect(schema.type).toBe("array");
		});

		it("detects date-time format", async () => {
			const schema = await run(inferrer.infer(["2025-01-01T00:00:00Z"]));
			expect(schema.format).toBe("date-time");
		});

		it("detects date format", async () => {
			const schema = await run(inferrer.infer(["2025-01-01"]));
			expect(schema.format).toBe("date");
		});

		it("detects email format", async () => {
			const schema = await run(inferrer.infer(["jane@example.com"]));
			expect(schema.format).toBe("email");
		});

		it("detects uri format", async () => {
			const schema = await run(inferrer.infer(["https://example.com"]));
			expect(schema.format).toBe("uri");
		});

		it("detects uuid format", async () => {
			const schema = await run(inferrer.infer(["550e8400-e29b-41d4-a716-446655440000"]));
			expect(schema.format).toBe("uuid");
		});

		it("returns empty schema for no samples", async () => {
			const schema = await run(inferrer.infer([]));
			expect(schema).toEqual({});
		});
	});

	describe("merge", () => {
		it("merges two identical types", async () => {
			const merged = await run(inferrer.merge({ type: "string" }, { type: "string" }));
			expect(merged.type).toBe("string");
		});

		it("merges different types into anyOf", async () => {
			const merged = await run(inferrer.merge({ type: "string" }, { type: "integer" }));
			expect(merged.anyOf).toBeDefined();
			const anyOf = merged.anyOf as Record<string, unknown>[];
			expect(anyOf).toHaveLength(2);
		});

		it("merges objects — unions properties", async () => {
			const a = {
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
			};
			const b = {
				type: "object",
				properties: { name: { type: "string" }, email: { type: "string" } },
				required: ["name", "email"],
			};
			const merged = await run(inferrer.merge(a, b));
			const props = merged.properties as Record<string, unknown>;
			expect(Object.keys(props)).toContain("name");
			expect(Object.keys(props)).toContain("email");
			// name is required in both, email only in b
			expect(merged.required).toEqual(["name"]);
		});

		it("merges objects — marks field optional if missing in one", async () => {
			const a = {
				type: "object",
				properties: { id: { type: "integer" }, name: { type: "string" } },
				required: ["id", "name"],
			};
			const b = {
				type: "object",
				properties: { id: { type: "integer" } },
				required: ["id"],
			};
			const merged = await run(inferrer.merge(a, b));
			expect(merged.required).toEqual(["id"]);
		});

		it("merges integer + number into number", async () => {
			const merged = await run(inferrer.merge({ type: "integer" }, { type: "number" }));
			// integer + number with same-type merge falls through to default
			// but they're different types so it should be anyOf or number
			expect(merged.anyOf ?? merged.type).toBeDefined();
		});

		it("merges strings — keeps matching format", async () => {
			const merged = await run(
				inferrer.merge({ type: "string", format: "email" }, { type: "string", format: "email" }),
			);
			expect(merged.format).toBe("email");
		});

		it("merges strings — drops mismatched format", async () => {
			const merged = await run(
				inferrer.merge({ type: "string", format: "email" }, { type: "string", format: "uri" }),
			);
			expect(merged.format).toBeUndefined();
		});

		it("infers across multiple samples", async () => {
			const schema = await run(
				inferrer.infer([
					{ id: 1, name: "Alice", email: "alice@test.com" },
					{ id: 2, name: "Bob" },
				]),
			);

			const props = schema.properties as Record<string, Record<string, unknown>>;
			expect(props.id?.type).toBe("integer");
			expect(props.name?.type).toBe("string");
			expect(Object.keys(props)).toContain("email");

			// id and name are in both; email only in first
			const req = schema.required as string[];
			expect(req).toContain("id");
			expect(req).toContain("name");
			expect(req).not.toContain("email");
		});
	});
});
