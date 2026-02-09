import { Schema } from "effect";

export class GalleryEntry extends Schema.Class<GalleryEntry>("GalleryEntry")({
	id: Schema.String,
	domain: Schema.String,
	url: Schema.String,
	task: Schema.String,
	endpointCount: Schema.Number,
	endpointsSummary: Schema.String,
	specKey: Schema.String,
	contributor: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	version: Schema.Number,
}) {}
