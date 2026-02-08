import { Schema } from "effect";

export class Site extends Schema.Class<Site>("Site")({
	id: Schema.String,
	url: Schema.String,
	domain: Schema.String,
	firstScoutedAt: Schema.String,
	lastScoutedAt: Schema.String,
}) {}
