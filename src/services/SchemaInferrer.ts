import { Context, Effect, Layer } from "effect";

// ==================== Service Interface ====================

export interface SchemaInferrerService {
	/** Infer a JSON Schema from one or more sample values */
	readonly infer: (samples: ReadonlyArray<unknown>) => Effect.Effect<Record<string, unknown>>;
	/** Merge two JSON Schemas into one that accepts both */
	readonly merge: (
		a: Record<string, unknown>,
		b: Record<string, unknown>,
	) => Effect.Effect<Record<string, unknown>>;
}

export class SchemaInferrer extends Context.Tag("SchemaInferrer")<
	SchemaInferrer,
	SchemaInferrerService
>() {}

// ==================== JSON Schema types ====================

type JsonSchema = Record<string, unknown>;

// ==================== Implementation ====================

function inferType(value: unknown): JsonSchema {
	if (value === null) return { type: "null" };
	if (value === undefined) return {};

	switch (typeof value) {
		case "string":
			return inferStringSchema(value);
		case "number":
			return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
		case "boolean":
			return { type: "boolean" };
		case "object":
			return Array.isArray(value) ? inferArraySchema(value) : inferObjectSchema(value);
		default:
			return {};
	}
}

/** Detect common string formats */
function inferStringSchema(value: string): JsonSchema {
	const schema: JsonSchema = { type: "string" };

	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
		schema.format = "date-time";
	} else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		schema.format = "date";
	} else if (/^[^@]+@[^@]+\.[^@]+$/.test(value)) {
		schema.format = "email";
	} else if (/^https?:\/\//.test(value)) {
		schema.format = "uri";
	} else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
		schema.format = "uuid";
	}

	return schema;
}

function inferArraySchema(arr: unknown[]): JsonSchema {
	if (arr.length === 0) return { type: "array", items: {} };

	// Infer schema from all items, then merge
	let itemSchema = inferType(arr[0]);
	for (let i = 1; i < arr.length; i++) {
		itemSchema = mergeSchemas(itemSchema, inferType(arr[i]));
	}

	return { type: "array", items: itemSchema };
}

function inferObjectSchema(obj: object): JsonSchema {
	const record = obj as Record<string, unknown>;
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const [key, val] of Object.entries(record)) {
		properties[key] = inferType(val);
		if (val !== null && val !== undefined) {
			required.push(key);
		}
	}

	const schema: JsonSchema = { type: "object", properties };
	if (required.length > 0) {
		schema.required = required;
	}
	return schema;
}

/** Infer a single schema from multiple samples */
function inferFromSamples(samples: ReadonlyArray<unknown>): JsonSchema {
	if (samples.length === 0) return {};

	let schema = inferType(samples[0]);
	for (let i = 1; i < samples.length; i++) {
		schema = mergeSchemas(schema, inferType(samples[i]));
	}
	return schema;
}

// ==================== Schema Merging ====================

function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
	const typeA = a.type as string | undefined;
	const typeB = b.type as string | undefined;

	// Empty schemas — return the other
	if (!typeA) return b;
	if (!typeB) return a;

	// Same type — merge deeply
	if (typeA === typeB) return mergeSameType(a, b, typeA);

	// integer + number → number (integer is a subset)
	if ((typeA === "integer" && typeB === "number") || (typeA === "number" && typeB === "integer")) {
		return { type: "number" };
	}

	// Different types — produce anyOf
	return mergeIntoAnyOf(a, b);
}

function mergeSameType(a: JsonSchema, b: JsonSchema, type: string): JsonSchema {
	switch (type) {
		case "object":
			return mergeObjectSchemas(a, b);
		case "array":
			return mergeArraySchemas(a, b);
		case "string":
			return mergeStringSchemas(a, b);
		case "integer":
			return { type: "integer" };
		case "number":
			return { type: "number" };
		default:
			return a;
	}
}

function mergeObjectSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
	const propsA = (a.properties ?? {}) as Record<string, JsonSchema>;
	const propsB = (b.properties ?? {}) as Record<string, JsonSchema>;
	const reqA = new Set((a.required as string[]) ?? []);
	const reqB = new Set((b.required as string[]) ?? []);

	const allKeys = new Set([...Object.keys(propsA), ...Object.keys(propsB)]);
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const key of allKeys) {
		const schemaA = propsA[key];
		const schemaB = propsB[key];

		if (schemaA && schemaB) {
			properties[key] = mergeSchemas(schemaA, schemaB);
			// Only required if required in both
			if (reqA.has(key) && reqB.has(key)) required.push(key);
		} else {
			properties[key] = schemaA ?? schemaB ?? {};
			// Present in only one sample → not required
		}
	}

	const schema: JsonSchema = { type: "object", properties };
	if (required.length > 0) schema.required = required;
	return schema;
}

function mergeArraySchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
	const itemsA = (a.items ?? {}) as JsonSchema;
	const itemsB = (b.items ?? {}) as JsonSchema;
	return { type: "array", items: mergeSchemas(itemsA, itemsB) };
}

function mergeStringSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
	// Keep format only if both agree
	if (a.format && a.format === b.format) return { type: "string", format: a.format };
	return { type: "string" };
}

function mergeIntoAnyOf(a: JsonSchema, b: JsonSchema): JsonSchema {
	const schemasA = (a.anyOf as JsonSchema[]) ?? [a];
	const schemasB = (b.anyOf as JsonSchema[]) ?? [b];

	// Dedupe by type
	const seen = new Set<string>();
	const merged: JsonSchema[] = [];
	for (const s of [...schemasA, ...schemasB]) {
		const key = JSON.stringify(s);
		if (!seen.has(key)) {
			seen.add(key);
			merged.push(s);
		}
	}

	return merged.length === 1 ? (merged[0] ?? {}) : { anyOf: merged };
}

// ==================== Service Factory ====================

export function makeSchemaInferrer(): SchemaInferrerService {
	return {
		infer: (samples) => Effect.succeed(inferFromSamples(samples)),
		merge: (a, b) => Effect.succeed(mergeSchemas(a, b)),
	};
}

export const SchemaInferrerLive = Layer.succeed(SchemaInferrer, makeSchemaInferrer());
