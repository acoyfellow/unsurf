import { Schema } from "effect";

export class NetworkEvent extends Schema.Class<NetworkEvent>("NetworkEvent")({
	requestId: Schema.String,
	url: Schema.String,
	method: Schema.String,
	resourceType: Schema.String,
	requestHeaders: Schema.Record({ key: Schema.String, value: Schema.String }),
	requestBody: Schema.optional(Schema.Unknown),
	responseStatus: Schema.Number,
	responseBody: Schema.optional(Schema.Unknown),
	responseHeaders: Schema.Record({ key: Schema.String, value: Schema.String }),
	timestamp: Schema.Number,
}) {}
