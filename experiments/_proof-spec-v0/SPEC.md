# proof-spec.v0.json

**Status:** draft, experimental. Not yet committed to either unsurf or gateproof. See `.context/THESIS-MERGE-UNSURF-GATEPROOF.md` for why this exists.

## What it is

A unified schema for **observe/act/assert loops** that currently live as two distinct shapes:

- unsurf's `tool-spec.v0.json` (DOM-focused, single-shot execution)
- gateproof's `PlanDefinition` (HTTP/exec-focused, loop until pass)

`proof-spec.v0.json` is a superset that either tool can consume. Specs can describe:
- A **tool** (just `act` — "do this thing")
- A **gate** (just `observe` + `assert` — "verify this claim")
- A **proof loop** (all three — "do it, check it, retry until it works")

## Schema

```json
{
	"$schema": "https://unsurf.coey.dev/schemas/proof-spec.v0.json",
	"version": "v0",

	"target": {
		"url": "https://example.com/contact",
		"fingerprint": "sha256:...",
		"fingerprintStrategy": "url+dom-structure-v1"
	},

	"name": "submit_contact_form",
	"description": "Submit the contact form. Verify the submission landed.",

	"inputSchema": {
		"type": "object",
		"properties": {
			"name":    { "type": "string" },
			"email":   { "type": "string", "format": "email" },
			"message": { "type": "string" }
		},
		"required": ["name", "email", "message"]
	},

	"observe": [
		{ "kind": "dom",  "target": { "role": "heading", "name": "Contact" } },
		{ "kind": "http", "url": "https://example.com/contact", "expect": { "status": 200 } }
	],

	"act": [
		{ "op": "fill",   "target": { "role": "textbox", "name": "Name" },    "value": "{{name}}" },
		{ "op": "fill",   "target": { "role": "textbox", "name": "Email" },   "value": "{{email}}" },
		{ "op": "fill",   "target": { "role": "textbox", "name": "Message" }, "value": "{{message}}" },
		{ "op": "click",  "target": { "role": "button",  "name": "Send" } }
	],

	"assert": [
		{ "kind": "textPresent", "value": "Thanks for your message" },
		{ "kind": "urlMatches",  "pattern": "/thanks" }
	],

	"loop": {
		"maxIterations": 3,
		"stopOnFailure": true
	},

	"risk": "medium",

	"provenance": {
		"synthesizedAt": "2026-04-19T10:30:00.000Z",
		"synthesizer": { "name": "exp-002b", "model": "@cf/qwen/qwen2.5-coder-32b-instruct", "promptHash": "sha256:..." }
	}
}
```

## Field reference

### Top-level

| Field | Type | Required | Purpose |
|---|---|---|---|
| `version` | `"v0"` | yes | Hardcoded. Breaking changes → `v1`. |
| `target` | Target | yes | What's the spec about? URL + fingerprint. |
| `name` | string | yes | `snake_case`, unique within a spec set. |
| `description` | string | yes | Human-readable, agent-visible. |
| `inputSchema` | JSON Schema | yes | Must be `{"type":"object"}`. Keys match `{{placeholder}}` refs in `act`. |
| `observe` | Observation[] | optional | Read current-world state before acting. Empty = skip observe. |
| `act` | DslOp[] | optional | Mutate the world. Empty = gate-only (verify without action). |
| `assert` | Assertion[] | optional | Verify post-state. Empty = fire-and-forget (not recommended). |
| `loop` | Loop | optional | How aggressively to retry. Absent = single-shot. |
| `risk` | `"low" \| "medium" \| "high"` | yes | Deterministic; runner must re-compute from `act`. |
| `provenance` | Provenance | optional | Where did this spec come from? Synthesizer or human. |

### `Target`

```
{
	url: string,                      // canonical URL
	fingerprint?: string,             // "sha256:" + hex
	fingerprintStrategy?: string      // e.g. "url+ax-role-name-v1"
}
```

### `observe[i]` — Observation

Union. All sources composable in one array.

```
// DOM observation (unsurf-native)
{ kind: "dom",  target: { role, name, nth? }, as?: "exists" | "text" | "value" }

// HTTP observation (gateproof-native)
{ kind: "http", url: string, expect?: { status?: number, bodyIncludes?: string } }

// Exec observation (gateproof-native; server-side only)
{ kind: "exec", command: string, expect?: { exitCode?: number, stdoutIncludes?: string } }

// Note observation (structured read from an LLM or external service; future)
{ kind: "note", source: string, field: string }
```

### `act[i]` — DslOp

Identical to unsurf's current 6-verb DSL plus one new op for gateproof compat:

```
{ op: "click",  target: Target }
{ op: "fill",   target: Target, value: string }          // substitutes {{arg}}
{ op: "select", target: Target, value: string }          // visible label of <option>
{ op: "check",  target: Target, value: boolean }
{ op: "submit", target: Target }
{ op: "read",   target: Target, as: "text" | "value" | "attr", attr?: string }
{ op: "exec",   command: string, timeoutMs?: number }     // NEW: for non-DOM execution
```

`Target` is role+name+optional-nth (unsurf shape). For `op: "exec"`, no target; just the command.

### `assert[i]` — Assertion

Union. All kinds composable.

```
// unsurf-native
{ kind: "textPresent",    value: string }                 // case-insensitive substring match in visible text
{ kind: "urlMatches",     pattern: string }               // regex against current URL
{ kind: "elementExists",  target: Target }

// gateproof-native
{ kind: "httpResponse",          url?: string, status?: number, durationUnder?: number }
{ kind: "responseBodyIncludes",  value: string }
{ kind: "noErrors" }                                      // evidence has no error entries
{ kind: "hasAction",             id: string }             // evidence includes an action with this id
{ kind: "numericDeltaFromEnv",   key: string, threshold: number }
```

Extending with new assertion kinds is additive.

### `loop` — Loop

```
{
	maxIterations?: number,    // default 1. If 1, no retry.
	stopOnFailure?: boolean,   // default true when maxIterations=1, false otherwise
	budget?: {
		timeMs?: number,       // wall-clock budget across iterations
		tokens?: number        // LLM token budget (if the worker uses one)
	}
}
```

When `loop.maxIterations > 1`:
- Runner executes `observe → act → assert`
- If all assertions pass → return pass
- Otherwise hand control to a **worker** (gateproof's concept): an LLM or agent that sees the spec + evidence and decides the next action
- Worker may propose a revised `act[]` for the next iteration
- Repeat until pass, budget exhausted, or `stopOnFailure=true` and a hard fail

**Risk interaction:** if `risk: "high"`, `loop.maxIterations` is forced to 1 (no retry on destructive actions without explicit human reconfirmation).

### `risk` — deterministic, non-negotiable

Same rules as `src/services/RiskLabeler.ts`:

- `low` = all ops are `read` or `observe`-only (no mutation)
- `medium` = mutations (`fill/select/check/click`) without `submit` or destructive verbs
- `high` = `submit` OR `click` with target.name matching `/\b(delete|remove|pay|buy|send|confirm|destroy|cancel|wipe|exfiltrate|purge|erase|trash|charge|deactivate|uninstall)\b/i`

Runners MUST re-compute this from `act[]`. Synthesizer-emitted `risk` is an advisory hint, never trusted.

### `provenance` — Provenance

```
{
	synthesizedAt?: string,     // ISO 8601 UTC
	synthesizer?: {
		name: string,             // "exp-002b" | "hand-written" | "gateproof:author"
		model?: string,           // "@cf/qwen/..." | "none"
		promptHash?: string       // "sha256:..." (regression detection)
	},
	author?: {
		name: string,             // user or team
		email?: string
	}
}
```

## Three usage modes

### Mode 1: Tool (unsurf shape)

`act` only. Invoke the spec with arguments; get a result.

```ts
const result = await runner.invoke(spec, { email: "jane@example.com", ... });
// result: { content: [{type: "text", text: "..."}], isError?: boolean }
```

### Mode 2: Gate (gateproof shape)

`observe` + `assert` only, no `act`. Verify a claim without doing anything.

```ts
const gate = await runner.verify(spec);
// gate: { status: "pass" | "fail", evidence: {...} }
```

### Mode 3: Proof loop (full)

All three. `observe → act → assert`, with optional iteration.

```ts
const proof = await runner.runLoop(spec, args);
// proof: { status, iterations, evidence, finalAssertions }
```

## Evidence bundle

Every run (invoke/verify/runLoop) returns an evidence bundle:

```
{
	status: "pass" | "fail" | "inconclusive",
	iterations: number,
	observations: ObservationResult[],
	actions: ActionResult[],
	assertions: AssertionResult[],
	content?: MCPContent[],      // for invoke() — the MCP-shaped tool return
	errors: string[]
}
```

This is what "proof-carrying agent output" means: the agent's claim = text + this bundle. Client verifies by replaying the bundle.

## Example: all three shapes on the same spec

```ts
// A read-only tool (no act, just observe+assert → behaves as a gate)
const readHeading = { ... act: [], observe: [{ kind: "dom", target: { role: "heading", name: "hello" }}], assert: [{ kind: "elementExists", target: {...}}] };

// A classic unsurf tool (act, no observe/assert)
const search = { ... act: [{ op: "fill", ... }, { op: "submit", ... }] };

// A full proof loop
const submitForm = {
	...,
	observe: [{ kind: "dom", target: { role: "heading", name: "Contact" }}],
	act:     [{ op: "fill", ... }, { op: "click", ... }],
	assert:  [{ kind: "textPresent", value: "Thanks" }],
	loop:    { maxIterations: 3 }
};
```

## Non-goals for v0

- Multi-URL specs (each spec is one `target.url`)
- Cross-spec composition (a spec can't call another spec)
- Binary evidence (no screenshots, no video — just text + structured data)
- Streaming assertions (no "wait until X, then Y" temporal logic)
- WebSocket / EventSource observations
- Shadow DOM piercing

If any of these become load-bearing, they're `v1`.

## Migration from current shapes

### From `tool-spec.v0.json` (unsurf)
- `url` → `target.url`
- `fingerprint` → `target.fingerprint`
- `fingerprintStrategy` → `target.fingerprintStrategy`
- `synthesizedAt`, `synthesizer` → `provenance.synthesizedAt`, `provenance.synthesizer`
- `tools[]` array → top-level spec (each tool becomes its own spec)
- `dsl[]` → `act[]`
- `postcondition` (single) → `assert[]` (array, same kinds)
- `risk` → `risk`

### From gateproof `PlanDefinition`
- `goals[].id` → top-level `name`
- `goals[].title` → `description`
- `goals[].gate.observe` → `observe[]` (wrap single observe-resource in array)
- `goals[].gate.act` → `act[]` (rename `ActionDefinition` kinds to op:"exec")
- `goals[].gate.assert` → `assert[]`
- `loop` → `loop`
- `goals[].scope` → separate concern; not in proof-spec v0

## Known design tensions

1. **`act` is ordered; `observe` and `assert` are parallel.** `act` semantics are imperative; others are declarative. Runner has a different contract for each. Clear but worth writing.
2. **`exec` ops blur client/server.** A spec with `op: "exec"` can only run server-side (Browser Rendering, Worker). Clients (unsurf-daemon) must reject `exec` ops. Document + enforce.
3. **Loop + HITL interaction.** `risk: "high"` + `loop.maxIterations > 1` is a paradox. Runner forces iterations=1 for high-risk specs.
4. **Observation vs action race.** An `observe: dom` that reads a mutable element races with the page. Runner should snapshot observations atomically or document the race.

## What's in this folder

```
_proof-spec-v0/
├── SPEC.md              ← this file
├── types.ts             ← TypeScript types (next: extract from this doc)
├── schema.json          ← JSON Schema (next: derive from types.ts)
└── examples/
    ├── tool-only.json   ← pure unsurf shape in new schema
    ├── gate-only.json   ← pure gateproof shape in new schema
    └── proof-loop.json  ← full observe/act/assert/loop
```

## Open questions

- Does the spec merge mean **merged repos** or **shared types package**? Memo says: shared types, separate repos (matches Mr. 0.0.1 — tiny things).
- Does the unified runner live in unsurf, gateproof, or a third package? Sketched as "either, both import the types; executors stay where they are."
- What's the blessed name for the merged primitive? "proof" is generic. "surface" taken. "atlas" taken. Open.

## Status

- **SPEC.md:** drafted (you're reading it).
- **types.ts:** not written yet. Next step if we commit to the merge.
- **examples/:** not written yet.
- **Integration:** zero. Neither unsurf nor gateproof imports this yet.

This is speculation hardened into a contract. It doesn't obligate either project until someone merges the PR that introduces `types.ts` + starts the migration.
