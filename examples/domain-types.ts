/**
 * Domain types — the core data structures unsurf uses.
 * This file is embedded in the docs and tested in CI.
 */
import { Option } from "effect";
import {
	API_RESOURCE_TYPES,
	CapturedEndpoint,
	NetworkEvent,
	PathStep,
	ScoutedPath,
	isApiRequest,
} from "unsurf";

// CapturedEndpoint — what the scout stores for each API endpoint
const endpoint = new CapturedEndpoint({
	id: "ep_abc123",
	siteId: "site_xyz",
	method: "GET",
	pathPattern: "https://api.example.com/users/:id",
	requestSchema: Option.none(),
	responseSchema: Option.some({
		type: "object",
		properties: { id: { type: "integer" }, name: { type: "string" } },
	}),
	sampleCount: 5,
	firstSeenAt: "2024-01-15T10:00:00Z",
	lastSeenAt: "2024-01-15T10:30:00Z",
});

console.log(endpoint.method, endpoint.pathPattern);
// → GET https://api.example.com/users/:id

// ScoutedPath — a replayable navigation path
const path = new ScoutedPath({
	id: "path_def456",
	siteId: "site_xyz",
	task: "find user profiles",
	steps: [
		new PathStep({ action: "navigate", url: "https://example.com" }),
		new PathStep({ action: "click", selector: "a.user-link" }),
	],
	endpointIds: ["ep_abc123"],
	status: "active",
	createdAt: "2024-01-15T10:00:00Z",
	lastUsedAt: Option.some("2024-01-15T10:30:00Z"),
	failCount: 0,
	healCount: 0,
});

console.log(path.status, path.steps.length, "steps");
// → active 2 steps

// NetworkEvent — a captured CDP network event
const event = new NetworkEvent({
	requestId: "req-1",
	url: "https://api.example.com/users",
	method: "GET",
	resourceType: "fetch",
	requestHeaders: { accept: "application/json" },
	responseStatus: 200,
	responseHeaders: { "content-type": "application/json" },
	responseBody: JSON.stringify([{ id: 1, name: "Alice" }]),
	timestamp: Date.now(),
});

// Filter: is this an API request we care about?
console.log(isApiRequest(event.resourceType, event.url));
// → true (fetch + not a static asset)

console.log(API_RESOURCE_TYPES);
// → ["fetch", "xhr"]
