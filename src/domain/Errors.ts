import { Schema } from "effect";

export class NetworkError extends Schema.TaggedError<NetworkError>()("NetworkError", {
	url: Schema.String,
	status: Schema.optional(Schema.Number),
	message: Schema.String,
}) {}

export class BrowserError extends Schema.TaggedError<BrowserError>()("BrowserError", {
	message: Schema.String,
	screenshot: Schema.optional(Schema.String),
}) {}

export class PathBrokenError extends Schema.TaggedError<PathBrokenError>()("PathBrokenError", {
	pathId: Schema.String,
	step: Schema.optional(Schema.Number),
	reason: Schema.String,
}) {}

export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
	message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
	id: Schema.String,
	resource: Schema.optional(Schema.String),
}) {}
