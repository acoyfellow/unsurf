# CONTRACT — `tool-spec.v0.json`

**This file is write-once.** Experiments consume or produce `tool-spec.v0.json`. No experiment modifies this schema. If an experiment discovers the schema is wrong, it logs that in `BACKLOG.md` and works around it for now.

## Purpose

`tool-spec.v0.json` is the composition glue between all experiments. A synthesizer produces it. A runner consumes it. A directory stores it. A fingerprinter keys it. A postcondition gate validates its effects.

If an artifact conforms to this schema, it slots into any experiment that reads the schema. That is the entire point.

## Schema

```json
{
  "$schema": "https://unsurf.coey.dev/schemas/tool-spec.v0.json",
  "version": "v0",
  "url": "https://example.com/contact",
  "fingerprint": "sha256:abc123...",
  "fingerprintStrategy": "url+dom-structure-v1",
  "synthesizedAt": "2026-04-18T10:30:00.000Z",
  "synthesizer": {
    "name": "exp-001-gemini-nano",
    "model": "gemini-nano",
    "promptHash": "sha256:..."
  },
  "tools": [
    {
      "name": "submit_contact_form",
      "description": "Submit the contact form on this page with name, email, and message.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name":    { "type": "string", "description": "Full name" },
          "email":   { "type": "string", "format": "email" },
          "message": { "type": "string", "description": "Body of the message" }
        },
        "required": ["name", "email", "message"]
      },
      "dsl": [
        { "op": "fill",   "target": { "role": "textbox",  "name": "Name" },    "value": "{{name}}" },
        { "op": "fill",   "target": { "role": "textbox",  "name": "Email" },   "value": "{{email}}" },
        { "op": "fill",   "target": { "role": "textbox",  "name": "Message" }, "value": "{{message}}" },
        { "op": "click",  "target": { "role": "button",   "name": "Send" } }
      ],
      "risk": "medium",
      "postcondition": {
        "kind": "textPresent",
        "value": "Thanks for your message"
      }
    }
  ]
}
```

## Field definitions

### Top-level

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `"v0"` | yes | Hardcoded. If you need a breaking change, propose `v1` in `BACKLOG.md`. |
| `url` | string | yes | Canonical URL the spec was synthesized against. Query strings stripped unless semantically meaningful (to be determined by exp-007). |
| `fingerprint` | string | yes | `"sha256:" + hex`. Defined by `fingerprintStrategy`. |
| `fingerprintStrategy` | string | yes | Identifier for how the fingerprint was computed. Current strategies live in `exp-007`. |
| `synthesizedAt` | ISO 8601 string | yes | UTC, with milliseconds and trailing `Z`. |
| `synthesizer` | object | yes | Provenance. See below. |
| `tools` | array of Tool | yes | Zero or more tools. Empty array is valid (means: page has no actionable tools). |

### `synthesizer`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Experiment name that produced it, e.g. `"exp-001-gemini-nano"`. |
| `model` | string | yes | Model identifier, e.g. `"gemini-nano"`, `"cf/llama-3.3-70b-instruct"`. |
| `promptHash` | string | yes | `"sha256:" + hex` of the synthesis prompt. Lets us detect prompt regressions. |

### `tools[i]`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | `snake_case`. Must be unique within `tools`. Max 64 chars. |
| `description` | string | yes | Human-readable. Max 500 chars. Passed to the calling agent's LLM. |
| `inputSchema` | JSON Schema | yes | Draft 2020-12 subset. Must be `{"type":"object"}`. Keys match `{{placeholders}}` in `dsl`. |
| `dsl` | array of DslOp | yes | Executed in order. Empty array is valid (tool is a no-op, probably for debugging). |
| `risk` | `"low" \| "medium" \| "high"` | yes | See risk rubric below. |
| `postcondition` | Postcondition | optional | If absent, no post-execution verification. |

### `DslOp` — the six verbs

Exactly six verbs. No more. If you need a seventh, log it in `BACKLOG.md` — don't invent one mid-experiment.

```
{ "op": "click",  "target": Target }
{ "op": "fill",   "target": Target, "value": string }   // value may contain {{arg}} placeholders
{ "op": "select", "target": Target, "value": string }   // <select> option by visible label
{ "op": "check",  "target": Target, "value": boolean }  // checkbox/radio
{ "op": "submit", "target": Target }                    // form submit (no button click)
{ "op": "read",   "target": Target, "as": "text" | "value" | "attr", "attr"?: string }
```

All ops take a `target: Target`. `read` ops contribute to the tool's return value; the returned object maps `read`-op indices to their values.

### `Target`

Role + accessible name. No CSS selectors. No XPath. No `id`. Resilience comes from role+name; see `exp-005`.

```
{
  "role": "button" | "textbox" | "combobox" | "link" | "checkbox" | "radio" | "heading" | "img" | "list" | "listitem" | "table" | "cell" | "form" | "region" | "dialog" | "tab" | "tabpanel" | "navigation" | "status",
  "name": string,        // the accessible name. case-insensitive exact match.
  "nth"?: number         // 0-indexed, used only when multiple elements share (role, name). default: 0.
}
```

If the synthesizer cannot determine a role or a stable accessible name, it must not emit the tool. Better to drop a tool than emit one with a brittle target.

### `Postcondition`

One of three kinds:

```
{ "kind": "textPresent",  "value": string }   // case-insensitive substring match on visible text after execution
{ "kind": "urlMatches",   "pattern": string } // regex against the URL after execution
{ "kind": "elementExists", "target": Target } // element resolves after execution
```

### Risk rubric

| Level | When |
|---|---|
| `low` | All ops are `read`. Safe to auto-execute. |
| `medium` | Includes `click` / `fill` / `select` / `check` but no `submit` on a form that appears to POST, and no destructive verbs in button text. |
| `high` | Includes `submit`, or any `click` on a button whose accessible name contains destructive verbs (`delete`, `remove`, `pay`, `buy`, `send`, `confirm`, `destroy`, `cancel`). HITL required before execution. |

The runner (exp-003) is responsible for enforcing HITL on `high`. The synthesizer is responsible for labeling honestly.

## Placeholders in `value`

String values in `fill` and `select` ops may contain `{{argName}}` placeholders. At execution time, the runner substitutes values from the `inputSchema`-validated arguments. Placeholders must reference keys declared in `inputSchema.properties`. Unknown placeholders are an execution error.

## Validation

A canonical Zod schema lives at `experiments/contract/tool-spec.v0.schema.ts` (to be written by the first experiment that needs it — probably exp-003 or exp-011). Until then, experiments hand-validate against this document.

## Non-goals for v0

Explicitly out of scope for v0. If your experiment needs any of these, log it in `BACKLOG.md` and keep going without it:

- Multi-step flows across page navigations (one tool = actions on one page state)
- Wait-for / poll / retry primitives in the DSL (runner handles stability, not the spec)
- File uploads, drag-and-drop, canvas interactions
- Shadow DOM piercing (target resolver may or may not handle it; note in RESULT.md)
- iframes (defer — WebMCP spec handles this differently anyway)
- Authentication state (the runner inherits the user's browser session; not a spec concern)
- Streaming / long-running tools
- Confidence scores on emitted tools
- Localization of `name` fields (accessible name is whatever the page renders to the user)

## Versioning

`"version": "v0"` is hardcoded throughout. The first breaking change triggers a `tool-spec.v1.json` with its own file. No silent migration. Experiments reading v0 must reject other versions.
