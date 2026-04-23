# vendor/

Vendored dependencies that aren't yet published to npm.

## `proof-spec/`

A copy of `~/cloudflare/proof-spec` (the `@acoyfellow/proof-spec` package) snapshotted into this repo so CI can `bun install` without needing access to the sibling directory on the build agent.

### Why this exists

The migration from inline `src/domain/ProofSpec.ts` to the shared
`@acoyfellow/proof-spec` package landed in `42bf1cc`, with a `file:../proof-spec`
dependency pointing at the local sibling checkout. That path works on
developer machines (where both repos live under `~/cloudflare/`) but breaks
on CI (which only clones unsurf). CI has been red since that commit.

Vendoring avoids the bootstrapping problem without preempting the planned
npm publish of `@acoyfellow/proof-spec@0.0.1`.

### How to keep it in sync

Until the package is published, manually refresh on changes:

```bash
cd ~/cloudflare/unsurf
rm -rf vendor/proof-spec
mkdir -p vendor/proof-spec
cp -R ~/cloudflare/proof-spec/{dist,src,package.json,README.md,LICENSE,tsconfig.json} vendor/proof-spec/
```

### When to remove this

The moment `@acoyfellow/proof-spec@0.0.1` is published:

1. `rm -rf vendor/proof-spec`
2. In `package.json`, change `"@acoyfellow/proof-spec": "file:./vendor/proof-spec"` to `"@acoyfellow/proof-spec": "^0.0.1"`
3. Delete this directory (and the `vendor/` dir if nothing else lives here).

The migration commit `42bf1cc1` explicitly calls out this follow-up in its message.
