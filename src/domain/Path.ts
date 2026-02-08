import { Schema } from "effect";

export class PathStep extends Schema.Class<PathStep>("PathStep")({
	action: Schema.Literal("navigate", "click", "fill", "submit", "wait"),
	selector: Schema.optional(Schema.String),
	value: Schema.optional(Schema.String),
	url: Schema.optional(Schema.String),
}) {}

const PathStatus = Schema.Literal("active", "broken", "healing");

export class ScoutedPath extends Schema.Class<ScoutedPath>("ScoutedPath")({
	id: Schema.String,
	siteId: Schema.String,
	task: Schema.String,
	steps: Schema.Array(PathStep),
	endpointIds: Schema.Array(Schema.String),
	status: PathStatus,
	createdAt: Schema.String,
	lastUsedAt: Schema.optionalWith(Schema.String, { as: "Option" }),
	failCount: Schema.Number,
	healCount: Schema.Number,
}) {}
