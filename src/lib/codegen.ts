// ==================== Types for OpenAPI 3.1 subset ====================

interface OpenApiSpec {
	readonly openapi?: string;
	readonly info?: { readonly title?: string };
	readonly servers?: ReadonlyArray<{ readonly url?: string }>;
	readonly paths?: Readonly<Record<string, PathItem>>;
	readonly components?: {
		readonly schemas?: Readonly<Record<string, JsonSchema>>;
	};
}

type PathItem = Readonly<Record<string, OperationObject>>;

interface OperationObject {
	readonly operationId?: string;
	readonly parameters?: ReadonlyArray<ParameterObject>;
	readonly requestBody?: {
		readonly required?: boolean;
		readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>>;
	};
	readonly responses?: Readonly<Record<string, ResponseObject>>;
}

interface ParameterObject {
	readonly name?: string;
	readonly in?: string;
	readonly required?: boolean;
	readonly schema?: JsonSchema;
}

interface ResponseObject {
	readonly description?: string;
	readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>>;
}

interface JsonSchema {
	readonly type?: string | ReadonlyArray<string>;
	readonly items?: JsonSchema;
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: ReadonlyArray<string>;
	readonly $ref?: string;
	readonly enum?: ReadonlyArray<unknown>;
	readonly allOf?: ReadonlyArray<JsonSchema>;
	readonly oneOf?: ReadonlyArray<JsonSchema>;
	readonly anyOf?: ReadonlyArray<JsonSchema>;
	readonly additionalProperties?: boolean | JsonSchema;
	readonly format?: string;
	readonly description?: string;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const METHODS_WITH_BODY = new Set(["post", "put", "patch"]);

// ==================== Name helpers ====================

function pascalCase(input: string): string {
	return input
		.replace(/[^a-zA-Z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join("");
}

function camelCase(input: string): string {
	const p = pascalCase(input);
	return p.charAt(0).toLowerCase() + p.slice(1);
}

/** Build a function name from method + path, e.g. GET /posts/{id} -> getPostsById */
function buildFunctionName(method: string, path: string): string {
	const segments = path
		.split("/")
		.filter(Boolean)
		.map((seg) => {
			if (seg.startsWith("{") && seg.endsWith("}")) {
				return `by_${seg.slice(1, -1)}`;
			}
			return seg;
		});
	return camelCase(`${method}_${segments.join("_")}`);
}

/**
 * Build a PascalCase type name from method + path + suffix.
 *
 *   buildTypeName("GET", "/posts/{id}", "Response")  -> "GetPostsByIdResponse"
 *   buildTypeName("POST", "/posts", "Body")          -> "PostPostsBody"
 */
function buildTypeName(method: string, path: string, suffix: string): string {
	const segments = path
		.split("/")
		.filter(Boolean)
		.map((seg) => {
			if (seg.startsWith("{") && seg.endsWith("}")) {
				return `By${pascalCase(seg.slice(1, -1))}`;
			}
			return pascalCase(seg);
		});
	return `${pascalCase(method)}${segments.join("")}${suffix}`;
}

/** Build an interface name from method + path, e.g. GET /posts -> GetPostsResponse */
function buildResponseTypeName(method: string, path: string): string {
	return buildTypeName(method, path, "Response");
}

function buildRequestBodyTypeName(method: string, path: string): string {
	return buildTypeName(method, path, "Body");
}

// ==================== Schema -> TypeScript ====================

function resolveRef(ref: string): string {
	// #/components/schemas/Foo -> Foo
	const parts = ref.split("/");
	const last = parts[parts.length - 1];
	return last ? pascalCase(last) : "unknown";
}

function joinSchemaTypes(schemas: ReadonlyArray<JsonSchema>, separator: string): string {
	const parts = schemas.map(schemaToTs);
	if (parts.length === 1) return parts[0] ?? "unknown";
	return `(${parts.join(separator)})`;
}

/** Convert a JSON Schema to an inline TypeScript type string */
function schemaToTs(schema: JsonSchema | undefined): string {
	if (!schema) return "unknown";

	if (schema.$ref) return resolveRef(schema.$ref);

	if (schema.allOf) {
		return joinSchemaTypes(schema.allOf, " & ");
	}

	if (schema.oneOf) {
		return joinSchemaTypes(schema.oneOf, " | ");
	}

	if (schema.anyOf) {
		return joinSchemaTypes(schema.anyOf, " | ");
	}

	if (schema.enum) {
		return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
	}

	const type = Array.isArray(schema.type) ? primaryType(schema.type) : schema.type;

	switch (type) {
		case "string":
			return "string";
		case "integer":
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "null":
			return "null";
		case "array":
			return `${schemaToTs(schema.items)}[]`;
		case "object":
			return objectSchemaToInlineTs(schema);
		default:
			return "unknown";
	}
}

/** Pick the first non-null type from a type union array */
function primaryType(types: ReadonlyArray<string>): string {
	for (const t of types) {
		if (t !== "null") return t;
	}
	return types[0] ?? "unknown";
}

function hasNullType(schema: JsonSchema): boolean {
	if (Array.isArray(schema.type)) {
		return schema.type.includes("null");
	}
	return schema.type === "null";
}

function emptyObjectToTs(schema: JsonSchema): string {
	if (schema.additionalProperties === true || schema.additionalProperties === undefined) {
		return "Record<string, unknown>";
	}
	if (typeof schema.additionalProperties === "object") {
		return `Record<string, ${schemaToTs(schema.additionalProperties)}>`;
	}
	return "Record<string, never>";
}

function formatPropType(propSchema: JsonSchema, isRequired: boolean): string {
	const nullable = hasNullType(propSchema);
	const tsType = schemaToTs(propSchema);
	const nullSuffix = nullable && !tsType.includes("null") ? " | null" : "";
	const undefinedSuffix = isRequired ? "" : " | undefined";
	return `${tsType}${nullSuffix}${undefinedSuffix}`;
}

function objectSchemaToInlineTs(schema: JsonSchema): string {
	const props = schema.properties;
	if (!props || Object.keys(props).length === 0) {
		return emptyObjectToTs(schema);
	}

	const requiredSet = new Set(schema.required ?? []);
	const lines: string[] = [];

	for (const [name, propSchema] of Object.entries(props)) {
		const isRequired = requiredSet.has(name);
		const opt = isRequired ? "" : "?";
		lines.push(`${safePropName(name)}${opt}: ${formatPropType(propSchema, isRequired)}`);
	}

	return `{ ${lines.join("; ")} }`;
}

function safePropName(name: string): string {
	return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// ==================== Interface generation ====================

function generateInterface(name: string, schema: JsonSchema): string {
	const lines: string[] = [];
	lines.push(`export interface ${name} {`);

	const props = schema.properties ?? {};
	const requiredSet = new Set(schema.required ?? []);

	for (const [propName, propSchema] of Object.entries(props)) {
		const isRequired = requiredSet.has(propName);
		const nullable = hasNullType(propSchema);
		const tsType = schemaToTs(propSchema);
		const opt = isRequired ? "" : "?";
		const nullSuffix = nullable && !tsType.includes("null") ? " | null" : "";
		const undefinedSuffix = !isRequired ? " | undefined" : "";

		if (propSchema.description) {
			lines.push(`\t/** ${propSchema.description} */`);
		}
		lines.push(`\t${safePropName(propName)}${opt}: ${tsType}${nullSuffix}${undefinedSuffix};`);
	}

	lines.push("}");
	return lines.join("\n");
}

// ==================== Function generation ====================

interface GeneratedFunction {
	readonly code: string;
	readonly extraInterfaces: string[];
}

function pickJsonSchema(
	content: Readonly<Record<string, { readonly schema?: JsonSchema }>>,
): JsonSchema | undefined {
	const entry = content["application/json"] ?? content["*/*"];
	return entry?.schema;
}

function resolveResponseType(
	schema: JsonSchema,
	method: string,
	path: string,
	extraInterfaces: string[],
): string {
	if (schema.$ref) return resolveRef(schema.$ref);

	if (schema.type === "array" && schema.items) {
		const itemType = resolveArrayItemType(schema.items, method, path, extraInterfaces);
		return `${itemType}[]`;
	}

	if (schema.type === "object" || schema.properties) {
		const typeName = buildResponseTypeName(method, path);
		extraInterfaces.push(generateInlineInterface(typeName, schema));
		return typeName;
	}

	return schemaToTs(schema);
}

function resolveArrayItemType(
	items: JsonSchema,
	method: string,
	path: string,
	extraInterfaces: string[],
): string {
	if (items.$ref) return resolveRef(items.$ref);
	const typeName = buildResponseTypeName(method, path);
	extraInterfaces.push(generateInlineInterface(typeName, items));
	return typeName;
}

function resolveBodyType(
	schema: JsonSchema,
	method: string,
	path: string,
	extraInterfaces: string[],
): string {
	if (schema.$ref) return resolveRef(schema.$ref);

	if (schema.type === "object" || schema.properties) {
		const typeName = buildRequestBodyTypeName(method, path);
		extraInterfaces.push(generateInlineInterface(typeName, schema));
		return typeName;
	}

	return schemaToTs(schema);
}

function collectParams(op: OperationObject): {
	pathParams: ParameterObject[];
	queryParams: ParameterObject[];
} {
	const pathParams: ParameterObject[] = [];
	const queryParams: ParameterObject[] = [];
	for (const param of op.parameters ?? []) {
		if (param.in === "path") pathParams.push(param);
		else if (param.in === "query") queryParams.push(param);
	}
	return { pathParams, queryParams };
}

function buildParamList(
	pathParams: ParameterObject[],
	bodyType: string | undefined,
	queryParams: ParameterObject[],
): string {
	const params: string[] = [];
	for (const p of pathParams) {
		const pType = p.schema ? schemaToTs(p.schema) : "string";
		params.push(`${camelCase(p.name ?? "param")}: ${pType}`);
	}
	if (bodyType) {
		params.push(`body: ${bodyType}`);
	}
	if (queryParams.length > 0) {
		const qProps = queryParams.map(formatQueryParam).join("; ");
		params.push(`query: { ${qProps} }`);
	}
	return params.join(", ");
}

function formatQueryParam(q: ParameterObject): string {
	const qType = q.schema ? schemaToTs(q.schema) : "string";
	const opt = q.required ? "" : "?";
	const undef = q.required ? "" : " | undefined";
	return `${safePropName(q.name ?? "param")}${opt}: ${qType}${undef}`;
}

function buildUrlLines(urlPath: string, queryParams: ParameterObject[]): string[] {
	const lines: string[] = [];
	if (queryParams.length > 0) {
		lines.push("\tconst params = new URLSearchParams();");
		for (const q of queryParams) {
			const accessor = `query.${camelCase(q.name ?? "param")}`;
			if (q.required) {
				lines.push(`\tparams.set(${JSON.stringify(q.name)}, String(${accessor}));`);
			} else {
				lines.push(
					`\tif (${accessor} !== undefined) params.set(${JSON.stringify(q.name)}, String(${accessor}));`,
				);
			}
		}
		lines.push(
			"\tconst qs = params.toString();",
			`\tconst url = \`\${baseUrl}${urlPath}\${qs ? \`?\${qs}\` : ""}\`;`,
		);
	} else {
		lines.push(`\tconst url = \`\${baseUrl}${urlPath}\`;`);
	}
	return lines;
}

function buildFetchLines(method: string, bodyType: string | undefined): string[] {
	const lines: string[] = [];
	const fetchOpts: string[] = [];

	if (method !== "get") {
		fetchOpts.push(`method: ${JSON.stringify(method.toUpperCase())}`);
	}
	if (bodyType) {
		fetchOpts.push('headers: { "Content-Type": "application/json" }');
		fetchOpts.push("body: JSON.stringify(body)");
	}

	const fetchCall =
		fetchOpts.length > 0 ? `await fetch(url, { ${fetchOpts.join(", ")} })` : "await fetch(url)";

	lines.push(`\tconst res = ${fetchCall};`);
	lines.push("\tif (!res.ok) throw new Error(`HTTP ${res.status}`);");
	lines.push("\treturn res.json();");
	return lines;
}

function generateFunction(method: string, path: string, op: OperationObject): GeneratedFunction {
	const fnName = op.operationId ? camelCase(op.operationId) : buildFunctionName(method, path);
	const extraInterfaces: string[] = [];
	const { pathParams, queryParams } = collectParams(op);

	// Determine response type
	let responseType = "unknown";
	const successResponse = op.responses?.["200"] ?? op.responses?.["201"];
	const responseSchema = successResponse?.content
		? pickJsonSchema(successResponse.content)
		: undefined;
	if (responseSchema) {
		responseType = resolveResponseType(responseSchema, method, path, extraInterfaces);
	}

	// Determine request body type
	let bodyType: string | undefined;
	if (METHODS_WITH_BODY.has(method) && op.requestBody?.content) {
		const bodySchema = pickJsonSchema(op.requestBody.content);
		if (bodySchema) {
			bodyType = resolveBodyType(bodySchema, method, path, extraInterfaces);
		}
	}

	// Build URL template
	const urlPath = path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
		return `\${encodeURIComponent(String(${camelCase(name)}))}`;
	});

	const paramStr = buildParamList(pathParams, bodyType, queryParams);
	const bodyLines = [...buildUrlLines(urlPath, queryParams), ...buildFetchLines(method, bodyType)];

	const code = [
		`export async function ${fnName}(${paramStr}): Promise<${responseType}> {`,
		...bodyLines,
		"}",
	].join("\n");

	return { code, extraInterfaces };
}

function generateInlineInterface(name: string, schema: JsonSchema): string {
	if (schema.type === "object" || schema.properties) {
		return generateInterface(name, schema);
	}
	// For non-object schemas, emit a type alias
	return `export type ${name} = ${schemaToTs(schema)};`;
}

// ==================== Main entry point ====================

function emitSchemas(schemas: Readonly<Record<string, JsonSchema>>): string[] {
	const chunks: string[] = [];
	for (const [name, schema] of Object.entries(schemas)) {
		chunks.push(generateInlineInterface(pascalCase(name), schema));
		chunks.push("");
	}
	return chunks;
}

function emitPaths(paths: Readonly<Record<string, PathItem>>): string[] {
	const chunks: string[] = [];
	for (const [path, pathItem] of Object.entries(paths)) {
		if (!pathItem) continue;
		for (const [method, operation] of Object.entries(pathItem)) {
			if (!HTTP_METHODS.has(method)) continue;
			const result = generateFunction(method, path, operation as OperationObject);
			for (const iface of result.extraInterfaces) {
				chunks.push(iface);
				chunks.push("");
			}
			chunks.push(result.code);
			chunks.push("");
		}
	}
	return chunks;
}

/** Generate a typed TypeScript fetch client from an OpenAPI 3.1 spec. */
export function generateClient(spec: object): string {
	const api = spec as OpenApiSpec;
	const serverUrl = api.servers?.[0]?.url ?? "http://localhost";

	const chunks: string[] = [
		"// Generated by unsurf",
		"",
		`export const baseUrl = ${JSON.stringify(serverUrl)};`,
		"",
	];

	if (api.components?.schemas) {
		chunks.push(...emitSchemas(api.components.schemas));
	}

	chunks.push(...emitPaths(api.paths ?? {}));

	return chunks.join("\n");
}
