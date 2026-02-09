import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const gallery = sqliteTable(
	"gallery",
	{
		id: text("id").primaryKey(),
		domain: text("domain").notNull(),
		url: text("url").notNull(),
		task: text("task").notNull(),
		endpointCount: integer("endpoint_count").notNull(),
		endpointsSummary: text("endpoints_summary").notNull(),
		specKey: text("spec_key").notNull(),
		contributor: text("contributor").default("anonymous"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
		version: integer("version").notNull().default(1),
	},
	(table) => [index("idx_gallery_domain").on(table.domain)],
);

// FTS5 virtual table for full-text search on gallery
export const galleryFts = sql`
CREATE VIRTUAL TABLE IF NOT EXISTS gallery_fts USING fts5(
	domain,
	url,
	task,
	endpoints_summary,
	content='gallery',
	content_rowid='rowid'
);
`;

// Triggers to keep gallery_fts in sync with gallery
export const galleryFtsSyncTriggers = [
	sql`
CREATE TRIGGER IF NOT EXISTS gallery_ai AFTER INSERT ON gallery BEGIN
	INSERT INTO gallery_fts(rowid, domain, url, task, endpoints_summary)
	VALUES (NEW.rowid, NEW.domain, NEW.url, NEW.task, NEW.endpoints_summary);
END;
`,
	sql`
CREATE TRIGGER IF NOT EXISTS gallery_ad AFTER DELETE ON gallery BEGIN
	INSERT INTO gallery_fts(gallery_fts, rowid, domain, url, task, endpoints_summary)
	VALUES ('delete', OLD.rowid, OLD.domain, OLD.url, OLD.task, OLD.endpoints_summary);
END;
`,
	sql`
CREATE TRIGGER IF NOT EXISTS gallery_au AFTER UPDATE ON gallery BEGIN
	INSERT INTO gallery_fts(gallery_fts, rowid, domain, url, task, endpoints_summary)
	VALUES ('delete', OLD.rowid, OLD.domain, OLD.url, OLD.task, OLD.endpoints_summary);
	INSERT INTO gallery_fts(rowid, domain, url, task, endpoints_summary)
	VALUES (NEW.rowid, NEW.domain, NEW.url, NEW.task, NEW.endpoints_summary);
END;
`,
];

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Endpoint = typeof endpoints.$inferSelect;
export type NewEndpoint = typeof endpoints.$inferInsert;
export type Path = typeof paths.$inferSelect;
export type NewPath = typeof paths.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Gallery = typeof gallery.$inferSelect;
export type NewGallery = typeof gallery.$inferInsert;
