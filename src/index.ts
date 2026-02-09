/**
 * unsurf — Turn any website into a typed API
 *
 * Package barrel export
 */

// Tools
export { scout } from "./tools/Scout.js";
export type { ScoutInput, ScoutResult } from "./tools/Scout.js";
export { worker } from "./tools/Worker.js";
export type { WorkerInput, WorkerResult } from "./tools/Worker.js";
export { heal } from "./tools/Heal.js";
export type { HealInput, HealResult } from "./tools/Heal.js";

// Services
export {
	Browser,
	BrowserCfLive,
	BrowserTestLive,
	makeTestBrowser,
	makeTestBrowserWithEvents,
} from "./services/Browser.js";
export type { BrowserService } from "./services/Browser.js";
export {
	Store,
	StoreD1Live,
	StoreTestLive,
	makeTestStore,
	makeD1Store,
} from "./services/Store.js";
export type { StoreService } from "./services/Store.js";
export {
	SchemaInferrer,
	SchemaInferrerLive,
	makeSchemaInferrer,
} from "./services/SchemaInferrer.js";
export type { SchemaInferrerService } from "./services/SchemaInferrer.js";
export {
	OpenApiGenerator,
	OpenApiGeneratorLive,
	makeOpenApiGenerator,
} from "./services/OpenApiGenerator.js";
export type { OpenApiGeneratorService } from "./services/OpenApiGenerator.js";

// Domain types
export { CapturedEndpoint } from "./domain/Endpoint.js";
export { ScoutedPath, PathStep } from "./domain/Path.js";
export {
	NetworkEvent,
	API_RESOURCE_TYPES,
	IGNORED_URL_PATTERNS,
	isApiRequest,
} from "./domain/NetworkEvent.js";
export { Site } from "./domain/Site.js";
export {
	NetworkError,
	BrowserError,
	PathBrokenError,
	StoreError,
	NotFoundError,
} from "./domain/Errors.js";

// Utilities
export { normalizeUrlPattern, extractDomain } from "./lib/url.js";

// Database (for advanced consumers)
export { createDb } from "./db/queries.js";
export type { Db } from "./db/queries.js";
export * as dbSchema from "./db/schema.js";
