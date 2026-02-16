# Task 17: MCP Tool Description Optimization — Evidence

**Date**: 2026-02-16
**File Modified**: `src/mcp.ts`

## Verification Results

| Check | Result |
|---|---|
| `bun run typecheck` | Pass |
| `bun run check` (biome) | Pass (no new errors; pre-existing issues in scripts/ and Scout.ts unrelated) |
| `bun run test` | 126/126 tests pass (13 test files) |
| LSP diagnostics on `src/mcp.ts` | 0 errors, 0 warnings |

## Before/After Comparison

### scout

**Before**:
```
"Explore a website and capture every API call. Returns captured endpoints with inferred schemas and an OpenAPI spec."
```

**After**:
```
"Use when you need to discover what API endpoints a website uses internally. Opens the URL in a headless browser, captures all network traffic (XHR/fetch), groups requests by endpoint pattern, infers request/response schemas, and generates an OpenAPI spec. Returns a siteId (for publishing), pathId (for replaying via worker), endpoint count, and the full OpenAPI spec. Check gallery/directory first — the site may already be captured."
```

**Improvements**: Decision trigger ("Use when..."), mechanism details, output format, cross-tool guidance.

### worker

**Before**:
```
"Replay a scouted API path directly — no browser needed. Pass the pathId from a scout result. Include headers for authenticated endpoints."
```

**After**:
```
"Use to execute a previously scouted API endpoint directly — no browser needed. Looks up the pathId from a scout result, finds the matching endpoint, and replays the HTTP request. Returns the API response. Requires a pathId from a previous scout result. If it fails, use 'heal' to fix the broken path."
```

**Improvements**: Error recovery guidance, explicit prerequisite, clearer mechanism.

### heal

**Before**:
```
"Fix a broken path. Retries with backoff, then re-scouts and patches if needed."
```

**After**:
```
"Use when a worker call fails — fixes broken API paths automatically. First retries the endpoint with exponential backoff (handles transient errors). If retries fail, re-scouts the original URL to discover updated endpoints, then verifies the new path works. Returns whether healing succeeded and optionally a new pathId to use going forward."
```

**Improvements**: Decision trigger, step-by-step mechanism, output description.

### gallery

**Before**:
```
"Search the API gallery for previously unsurfed sites. Check here before scouting — someone may have already captured the API you need."
```

**After**:
```
"Search the cache of previously scouted APIs before using scout. Returns matching sites with their domains, endpoint counts, and OpenAPI spec availability. Much faster than scouting — no browser needed. Use this first to avoid redundant scouting."
```

**Improvements**: Output format, performance guidance, clearer relationship to scout.

### directory

**Before**:
```
"Fingerprint-first API directory. Look up domains, browse capabilities, inspect endpoints, semantic search, or publish scouted sites. Check here before scouting — returns token-efficient fingerprints, not full specs."
```

**After**:
```
"The public API directory — look up domains, browse by capability, inspect endpoints, or search across all known APIs. Start with 'fingerprint' for a lightweight overview (~50 tokens), drill into 'capability' for endpoint lists, or use 'search' for semantic matching. Use 'publish' to add a scouted site. Token-efficient: returns compact fingerprints, not full specs."
```

**Improvements**: Progressive disclosure guidance, token cost hints, action-oriented.

### agent-scout

**Before**:
```
"LLM-guided exploration — an AI agent clicks, types, and navigates to find more API endpoints than a simple page load."
```

**After**:
```
"Use instead of regular scout when the site requires interaction — clicking buttons, filling forms, navigating menus — to trigger API calls that wouldn't appear from a simple page load. An AI agent controls the browser, performing actions you describe, while capturing all network traffic. More thorough but slower and more expensive than regular scout. Use regular scout first; escalate to agent-scout if it finds too few endpoints."
```

**Improvements**: Decision trigger vs regular scout, cost/speed tradeoff, escalation guidance.

## Input Schema Description Changes

All parameter `.describe()` strings updated with:
- Examples (e.g. `"Full URL to scout, e.g. 'https://api.example.com'"`)
- Format hints (e.g. `"Path ID from a scout result (format: path_<timestamp>_<random>)"`)
- Usage context (e.g. `"Data for the request. Used as JSON body for POST/PUT/PATCH, or substituted into URL params for GET"`)

## Optimization Principles Applied

1. **First sentence = decision trigger** — tells the agent WHEN to use this tool
2. **Second sentence = mechanism** — what happens under the hood
3. **Third sentence = output format** — what the agent gets back
4. **Cross-tool guidance** — "check gallery first", "use heal if it fails", "escalate to agent-scout"
5. **Under 200 tokens each** — all descriptions within budget

## Expected Tool Selection Behavior

| User Task | Expected Selection |
|---|---|
| "Find the weather API" | gallery/directory → scout (if not found) |
| "Get today's forecast from weather.com" | worker (if pathId exists) → scout (if not) |
| "The weather endpoint stopped working" | heal |
| "Map the login flow on example.com" | scout |
| "Click through the checkout process" | agent-scout |
| "What APIs are in the directory?" | directory (fingerprint action) |
