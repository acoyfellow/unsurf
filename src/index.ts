/**
 * unsurf — Turn any website into a typed API
 *
 * Package barrel export
 */

export type { AnthropicConfig } from "./ai/AnthropicProvider.js";
export { makeAnthropicProvider } from "./ai/AnthropicProvider.js";
export type { AgentAction, AgentStep, LlmContext, LlmProvider } from "./ai/ScoutAgent.js";
// AI Scout Agent
export { MAX_AGENT_STEPS, runScoutAgent, SCOUT_SYSTEM_PROMPT } from "./ai/ScoutAgent.js";
export type { Db } from "./db/queries.js";
// Database (for advanced consumers)
export { createDb } from "./db/queries.js";
export * as dbSchema from "./db/schema.js";
// Domain types
export { CapturedEndpoint } from "./domain/Endpoint.js";
export {
	BrowserError,
	NetworkError,
	NotFoundError,
	PathBrokenError,
	StoreError,
} from "./domain/Errors.js";
export {
	AuthType,
	Capability,
	CapabilitySlice,
	EndpointSummary,
	Fingerprint,
	SearchResult,
} from "./domain/Fingerprint.js";
export { GalleryEntry } from "./domain/Gallery.js";
export {
	API_RESOURCE_TYPES,
	IGNORED_URL_PATTERNS,
	isApiRequest,
	NetworkEvent,
} from "./domain/NetworkEvent.js";
export { PathStep, ScoutedPath } from "./domain/Path.js";
export { Site } from "./domain/Site.js";
// Codegen
export { generateClient } from "./lib/codegen.js";
// Safety
export type { RiskLevel, SafetyClassification } from "./lib/safety.js";
export {
	classifyEndpoint as classifySafety,
	requiresConfirmation,
} from "./lib/safety.js";
// Utilities
export { extractDomain, normalizeUrlPattern } from "./lib/url.js";
export type { SiteValidation, ValidationResult } from "./lib/validate.js";
export {
	validateEndpoint,
	validateSite,
	validateSiteEffect,
} from "./lib/validate.js";
// MCP
export { createMcpServer, handleMcpRequest } from "./mcp.js";
export type { BrowserService } from "./services/Browser.js";
// Services
export {
	Browser,
	BrowserCfLive,
	BrowserTestLive,
	makeTestBrowser,
	makeTestBrowserWithEvents,
} from "./services/Browser.js";
export type { DirectoryService } from "./services/Directory.js";
export {
	classifyEndpoint,
	Directory,
	DirectoryD1Live,
	detectAuth,
	generateSummary,
	makeD1Directory,
} from "./services/Directory.js";
export type { GalleryService, KvCacheService } from "./services/Gallery.js";
export {
	Gallery,
	GalleryD1Live,
	GalleryTestLive,
	KvCache,
	KvCacheLive,
	makeD1Gallery,
	makeKvCache,
	makeTestGallery,
} from "./services/Gallery.js";
export type { OpenApiGeneratorService } from "./services/OpenApiGenerator.js";
export {
	makeOpenApiGenerator,
	OpenApiGenerator,
	OpenApiGeneratorLive,
} from "./services/OpenApiGenerator.js";
export type { SchemaInferrerService } from "./services/SchemaInferrer.js";
export {
	makeSchemaInferrer,
	SchemaInferrer,
	SchemaInferrerLive,
} from "./services/SchemaInferrer.js";
export type { StoreService } from "./services/Store.js";
export {
	makeD1Store,
	makeTestStore,
	Store,
	StoreD1Live,
	StoreTestLive,
} from "./services/Store.js";
export type { HealInput, HealResult } from "./tools/Heal.js";
export { heal } from "./tools/Heal.js";
export type { ScoutInput, ScoutResult } from "./tools/Scout.js";
// Tools
export { scout } from "./tools/Scout.js";
export type { WorkerInput, WorkerResult } from "./tools/Worker.js";
export { worker } from "./tools/Worker.js";
