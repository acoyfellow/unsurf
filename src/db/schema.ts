import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
	id: text("id").primaryKey(),
	url: text("url").notNull(),
	domain: text("domain").notNull(),
	firstScoutedAt: text("first_scouted_at").notNull(),
	lastScoutedAt: text("last_scouted_at").notNull(),
});

export const endpoints = sqliteTable(
	"endpoints",
	{
		id: text("id").primaryKey(),
		siteId: text("site_id")
			.notNull()
			.references(() => sites.id),
		method: text("method").notNull(),
		pathPattern: text("path_pattern").notNull(),
		requestSchema: text("request_schema"),
		responseSchema: text("response_schema"),
		requestHeaders: text("request_headers"),
		responseHeaders: text("response_headers"),
		sampleCount: integer("sample_count").notNull().default(1),
		firstSeenAt: text("first_seen_at").notNull(),
		lastSeenAt: text("last_seen_at").notNull(),
	},
	(table) => [
		uniqueIndex("endpoints_site_method_path").on(table.siteId, table.method, table.pathPattern),
	],
);

export const paths = sqliteTable("paths", {
	id: text("id").primaryKey(),
	siteId: text("site_id")
		.notNull()
		.references(() => sites.id),
	task: text("task").notNull(),
	steps: text("steps").notNull().default("[]"),
	endpointIds: text("endpoint_ids").notNull().default("[]"),
	status: text("status").notNull().default("active"),
	createdAt: text("created_at").notNull(),
	lastUsedAt: text("last_used_at"),
	failCount: integer("fail_count").notNull().default(0),
	healCount: integer("heal_count").notNull().default(0),
});

export const runs = sqliteTable("runs", {
	id: text("id").primaryKey(),
	pathId: text("path_id").references(() => paths.id),
	tool: text("tool").notNull(),
	status: text("status").notNull(),
	input: text("input").notNull(),
	output: text("output"),
	error: text("error"),
	durationMs: integer("duration_ms"),
	harKey: text("har_key"),
	createdAt: text("created_at").notNull(),
});

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Endpoint = typeof endpoints.$inferSelect;
export type NewEndpoint = typeof endpoints.$inferInsert;
export type Path = typeof paths.$inferSelect;
export type NewPath = typeof paths.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
