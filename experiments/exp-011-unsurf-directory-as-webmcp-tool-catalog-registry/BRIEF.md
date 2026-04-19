# exp-011-unsurf-directory-as-webmcp-tool-catalog-registry

## Status: Deferred pending at least one synthesizer pass

This experiment is a DESIGN-ONLY exercise for the Directory schema extension. It only pays off if there are real tool-spec.v0.json artifacts to store — which requires exp-001 OR exp-002 to be Pass first. Designing a storage contract for a dataset that does not exist is premature. exp-011 runs ONLY AFTER at least one synthesizer experiment is Pass. Until then, this BRIEF is retained as scope but not executed. If the branch goes Green (see THESIS.md), exp-011 is skipped entirely and its output is produced directly as the implementation PR.

## Question
Design an additive extension to `src/services/Directory.ts` and `src/db/schema.ts` that stores, retrieves, and shares `tool-spec.v0.json` entries keyed by fingerprint, without breaking any existing API-path registry behavior.

## Why this question
The Directory is the composition glue: every other experiment in this branch either produces `tool-spec.v0.json` (synthesizers: exp-001, exp-002, exp-006) or consumes it (runners: exp-003; clients: exp-004, exp-010; fingerprinters: exp-007). If the Directory cannot cheaply key, store, and serve specs by fingerprint, the loop doesn't close — each agent re-synthesizes on every visit and the "shared registry" value prop dies. Answering this also rules out a parallel-table-and-parallel-service fork: if the existing Directory can host both API paths and tool catalogs with a ~100-line additive patch, we commit; if it can't, exp-011 documents why and we spin up a sibling service. A ship-ready design here unblocks the next PR after this experiment passes — implementation is intentionally the follow-up, not this brief.

## Method
1. Re-read `src/services/Directory.ts:14-50` (service interface), `src/services/Directory.ts:141-503` (D1 implementation), and `src/db/schema.ts:81-124` (existing `fingerprints` and `directory_endpoints` tables). Confirm that no existing column name, index name, or route path collides with the proposed additions.
2. Draft a new Drizzle table `toolCatalog` in `src/db/schema.ts` with these columns:
   - `fingerprint` text, primary key — matches `tool-spec.v0.json#/fingerprint` (e.g. `sha256:abc...`), NOT a foreign key to `fingerprints.id` (intentional: the existing `fingerprints` table is keyed by synthetic `fp_*` id with a `domain` unique; the tool catalog is keyed by DOM-structure fingerprint per exp-007 and is a different identity space — document this explicitly).
   - `url` text not null — canonical URL the spec was synthesized against.
   - `strategy` text not null — mirror of `tool-spec.v0.json#/fingerprintStrategy` (e.g. `"url+dom-structure-v1"`).
   - `synthesized_at` text not null — ISO-8601 UTC from `tool-spec.v0.json#/synthesizedAt`.
   - `synthesizer_name` text not null — from `synthesizer.name`.
   - `synthesizer_model` text not null — from `synthesizer.model`.
   - `prompt_hash` text not null — from `synthesizer.promptHash`.
   - `spec_json` text not null — the full verbatim `tool-spec.v0.json` as a string (D1 row cap is 1 MB; a typical spec is 1-10 KB, so a single column is fine).
   - `hit_count` integer not null default 0 — incremented by `GET /catalog/:fingerprint` on cache hit, for eviction/observability.
   - `created_at` text not null, `updated_at` text not null — standard bookkeeping.
   - Indices: `idx_tool_catalog_url` on `url` (for `GET /catalog?url=`), `idx_tool_catalog_synthesized_at` on `synthesized_at` (for freshness queries).
3. Draft the Drizzle migration SQL as a new file at `migrations/0004_tool_catalog.sql` (numbering to be confirmed against the highest existing migration in `migrations/` at implementation time) containing only `CREATE TABLE IF NOT EXISTS tool_catalog (...)` and the two `CREATE INDEX IF NOT EXISTS ...` statements. **Do not run it.** Include the SQL inline in this experiment's RESULT.md.
4. Design three new HTTP routes, additive-only, in the existing `/d/*` namespace per `AGENTS.md`:
   - `POST /d/catalog` — body: a full `tool-spec.v0.json`. Validate against the v0 contract (hand-validation per `CONTRACT.md:142` until the Zod schema ships; this experiment proposes Zod lives at `experiments/contract/tool-spec.v0.schema.ts` and is imported here once available). Reject `version !== "v0"`. Upsert on `fingerprint` primary key. Returns 201 on create, 200 on update, 400 on schema violation.
   - `GET /d/catalog/:fingerprint` — returns the stored `spec_json` verbatim (preserves byte-level fidelity; no re-serialization). Increments `hit_count`. 404 on miss.
   - `GET /d/catalog?url=<encoded>` — returns 0..n specs matching the URL (the same URL may have multiple fingerprints across time/DOM variants; that's informative, not a bug). Sorted by `synthesized_at` desc. Empty array on miss (200, not 404 — "no specs for this URL yet" is a normal state for an agent doing a cache-check-before-synthesize).
5. Extend the `DirectoryService` interface in `src/services/Directory.ts:14` (additive; no existing signatures changed) with three methods returning `Effect.Effect<...>` in the existing style:
   - `putCatalog: (spec: ToolSpecV0) => Effect.Effect<{ created: boolean }, StoreError | ValidationError>`
   - `getCatalogByFingerprint: (fingerprint: string) => Effect.Effect<ToolSpecV0, NotFoundError | StoreError>`
   - `getCatalogByUrl: (url: string) => Effect.Effect<ToolSpecV0[], StoreError>`
   Provide `makeD1Directory` and `makeTestDirectory` method bodies in pseudocode only (no implementation — next PR's job).
6. Write auth/rate-limit notes: (a) `POST /d/catalog` must gate on the same contributor mechanism `publish` uses today (`contributor` param, defaulting to `"anonymous"` — see `src/services/Directory.ts:253`). (b) Rate limits: propose `60 req/min/IP` for `POST /d/catalog` and `600 req/min/IP` for the two `GET` routes; defer enforcement mechanism (Cloudflare Rate Limiting binding vs. in-Worker KV counter) to the implementation PR. (c) Document that `spec_json` is public by construction — no PII scrubbing requirement; synthesizers are responsible for not emitting sensitive values into the contract.
7. Draft a one-paragraph migration compatibility statement: `fingerprints` and `directory_endpoints` tables are untouched; `publish` is untouched; the three existing `GET /d/:domain...` routes are untouched. The new table and routes are purely additive and can be deployed behind a feature flag or fully open, at the implementer's discretion.
8. Collect all of the above into `RESULT.md` in this experiment's folder at kill-by.

## Inputs
- `src/services/Directory.ts` (current service interface and D1 implementation).
- `src/db/schema.ts` (current `fingerprints` and `directory_endpoints` Drizzle tables).
- `experiments/CONTRACT.md` (tool-spec.v0.json schema — verbatim, do not modify).
- `AGENTS.md` (`/d/*` route conventions).
- No runtime inputs. This is a design experiment; no test URLs, no LLM calls, no DB access.

## Outputs
- `RESULT.md` containing:
  - The complete Drizzle `toolCatalog` table definition (TypeScript, paste-ready for `src/db/schema.ts`).
  - The complete migration SQL (`CREATE TABLE` + indices), ready to drop into `migrations/`.
  - The three new method signatures for `DirectoryService`, matching the existing Effect style.
  - The three route specs (method, path, request body shape, response shape, status codes).
  - Auth and rate-limit notes.
  - Migration compatibility statement.
  - A "next PR checklist" — the ordered list of edits the implementation PR must make.
- This experiment does **not** produce `tool-spec.v0.json` itself. It produces the storage contract *for* it.

## Kill-by
2 hours.

## Pass / Fail / Ambiguous criteria
- **Pass**: RESULT.md contains (1) a Drizzle table definition that compiles in isolation against the existing `src/db/schema.ts` imports, (2) a CREATE TABLE migration SQL that a reviewer can paste into a new migration file without edits, (3) three fully-specified route handlers (inputs, outputs, status codes, error cases), (4) a written guarantee that no existing column, index, route, or service method is modified, and (5) the auth/rate-limit notes. All five must be present.
- **Fail**: Any of (1)-(5) missing, OR the design requires modifying `fingerprints` / `directory_endpoints` / existing routes, OR the design depends on a `tool-spec.v0.json` field not in `CONTRACT.md`.
- **Ambiguous**: The design is additive and complete, but there is an unresolved question about identity (e.g., whether `fingerprint` in the tool catalog must reconcile with `fingerprints.id`). If ambiguous, RESULT.md must state the open question precisely and propose a default resolution for the implementer.

## What could surprise us
- The existing `fingerprints` table's synthetic `fp_*` id and domain-unique constraint actually *does* want to be the same identity space as WebMCP fingerprints — in which case the design collapses to "add spec columns to `fingerprints`" and the separate `tool_catalog` table is over-engineering. Worth checking during step 1.
- Multiple specs per URL is common enough (different DOM states: logged-in vs. anonymous, A/B variants, locale) that the `GET /d/catalog?url=` route is the *primary* read path, not the fingerprint lookup. That would change the caching story for consumers.
- D1's 1 MB row limit is not the binding constraint; the binding constraint is that `spec_json` stored as TEXT makes JSON-path queries impossible, and we'll want `dsl` op counts or risk distributions queryable within 6 months — in which case a second denormalized columns should be drafted now even if unused.

## Integration target
If this experiment passes, the next PR edits exactly these files:
- `src/db/schema.ts` — add `toolCatalog` table and its type exports.
- `migrations/<next-number>_tool_catalog.sql` — new file with the CREATE TABLE + indices.
- `src/services/Directory.ts` — extend `DirectoryService` interface with `putCatalog`, `getCatalogByFingerprint`, `getCatalogByUrl`; implement in both `makeD1Directory` and `makeTestDirectory`.
- `src/cf-worker.ts` (route wiring) — add the three `/d/catalog*` routes.
- `experiments/contract/tool-spec.v0.schema.ts` — if not yet created by exp-003, create the Zod validator here.
- No touches to `src/tools/Scout.ts`, `src/domain/Fingerprint.ts`, or `src/services/SchemaInferrer.ts`.

## Contract interaction
**Consumes** `tool-spec.v0.json` over HTTP on `POST /d/catalog`. **Produces** `tool-spec.v0.json` over HTTP on both `GET /d/catalog/:fingerprint` and `GET /d/catalog?url=`. Fields specifically relied upon for storage and indexing: `version` (must be `"v0"`, rejected otherwise), `url`, `fingerprint`, `fingerprintStrategy`, `synthesizedAt`, `synthesizer.name`, `synthesizer.model`, `synthesizer.promptHash`. The `tools` array is stored as part of `spec_json` but not decomposed into normalized rows in v0 — decomposition is a future experiment if query patterns demand it.

## Out of scope
- Implementing the migration, the routes, or the service methods. This is a design doc; the implementation is the follow-up PR.
- Writing the Zod schema for `tool-spec.v0.json`. If exp-003 hasn't produced it yet, note the dependency and move on.
- Changing `publish`, `getFingerprint`, `getCapabilitySlice`, `getEndpoint`, `getSpec`, `search`, `list`, or `delete` in `DirectoryService`. Those are load-bearing for the existing API-path flow and must remain untouched.
- Designing eviction, TTL, or re-synthesis triggers for stale specs. `hit_count` is included for future eviction, but policy is out of scope.
- Designing the client-side cache-check-before-synthesize flow. That belongs to whichever experiment ships the synthesizer integration (exp-001, exp-002, or a successor).
