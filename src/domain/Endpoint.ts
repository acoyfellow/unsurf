import { Schema } from "effect";

const HttpMethod = Schema.Literal("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS");

export class CapturedEndpoint extends Schema.Class<CapturedEndpoint>("CapturedEndpoint")({
	id: Schema.String,
	siteId: Schema.String,
	method: HttpMethod,
	pathPattern: Schema.String,
	requestSchema: Schema.optionalWith(Schema.Unknown, { as: "Option" }),
	responseSchema: Schema.optionalWith(Schema.Unknown, { as: "Option" }),
	sampleCount: Schema.Number,
	firstSeenAt: Schema.String,
	lastSeenAt: Schema.String,
}) {}
