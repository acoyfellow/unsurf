# _proof-spec-v0

> **Archived design artifact.** The schema in `SPEC.md` graduated to
> `src/services/Plan.ts`. This folder is kept for the design narrative
> only — the working code lives in `src/`.

The unified schema for `observe/act/assert` loops across unsurf and gateproof. Same pattern, two projects, drifting — so this folder drafted one schema both can consume.

## Why it's here

`.context/THESIS-MERGE-UNSURF-GATEPROOF.md` makes the case. Short version: unsurf and gateproof are the same shape at different altitudes. Merging their schemas unlocks a runtime-correctness primitive for agents acting on the web.

## What's in the folder

```
_proof-spec-v0/
├── README.md            ← this file
├── SPEC.md              ← the contract — field-by-field reference + non-goals
└── examples/
    ├── tool-only.json   ← pure unsurf shape (act only)
    ├── gate-only.json   ← pure gateproof shape (observe + assert, no act)
    └── proof-loop.json  ← full observe/act/assert with loop
```

The TypeScript types and runner that originally lived here are now in
`src/` (see `src/services/Plan.ts`). They were removed from this folder
to avoid stale-clone noise — git history retains the original drafts.

## Status

- ✅ Schema drafted (`SPEC.md`)
- ✅ TypeScript types live in `src/services/Plan.ts`
- ✅ Three worked examples (`examples/*.json`)
- ✅ Plan executor merged to `src/`
- ❌ JSON Schema file (to be derived from `src/services/Plan.ts` types)
- ❌ gateproof importing the unified shape (still uses its own `PlanDefinition`)

## What happens next if the merge is greenlit

1. **Extract `src/services/Plan.ts` types into a tiny npm package** (name TBD — candidates: `proof-spec`, `@acoyfellow/proof-spec`, `@unsurf/spec`). Both unsurf and gateproof depend on it.
2. **Migrate gateproof's `PlanDefinition`** — slightly harder, since gateproof is public on npm at its own version. Probably ships as `gateproof@v1` with the old shape deprecated but still accepted via a compat shim for a release.
3. **Write a cross-runner compatibility test:** same `proof-loop.json` executable by both unsurf and gateproof.

## What happens if we don't merge

This folder stays as a design artifact. Both projects ship separately. The schema drift gets worse over time, and we eventually either re-do this exercise under pressure or accept the split forever. Either is OK.

## To contribute or sanity-check

The highest-leverage feedback is in `SPEC.md`'s "Known design tensions" section at the bottom. Those are the places the merge could still come apart.
