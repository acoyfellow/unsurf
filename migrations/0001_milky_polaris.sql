CREATE TABLE `gallery` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`url` text NOT NULL,
	`task` text NOT NULL,
	`endpoint_count` integer NOT NULL,
	`endpoints_summary` text NOT NULL,
	`spec_key` text NOT NULL,
	`contributor` text DEFAULT 'anonymous',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gallery_domain` ON `gallery` (`domain`);--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS gallery_fts USING fts5(
	domain,
	url,
	task,
	endpoints_summary,
	content='gallery',
	content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS gallery_ai AFTER INSERT ON gallery BEGIN
	INSERT INTO gallery_fts(rowid, domain, url, task, endpoints_summary)
	VALUES (NEW.rowid, NEW.domain, NEW.url, NEW.task, NEW.endpoints_summary);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS gallery_ad AFTER DELETE ON gallery BEGIN
	INSERT INTO gallery_fts(gallery_fts, rowid, domain, url, task, endpoints_summary)
	VALUES ('delete', OLD.rowid, OLD.domain, OLD.url, OLD.task, OLD.endpoints_summary);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS gallery_au AFTER UPDATE ON gallery BEGIN
	INSERT INTO gallery_fts(gallery_fts, rowid, domain, url, task, endpoints_summary)
	VALUES ('delete', OLD.rowid, OLD.domain, OLD.url, OLD.task, OLD.endpoints_summary);
	INSERT INTO gallery_fts(rowid, domain, url, task, endpoints_summary)
	VALUES (NEW.rowid, NEW.domain, NEW.url, NEW.task, NEW.endpoints_summary);
END;
