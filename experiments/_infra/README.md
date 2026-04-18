# _infra

Shared infrastructure for experiments in this branch. NOT an experiment itself.

- `synth-worker/` — minimal Cloudflare Worker exposing Workers AI inference (`POST /run`) so experiments can call Llama/Qwen locally via `wrangler dev` without an API token. Uses the `AI` binding from unsurf's account.
- Any other shared harness that multiple experiments need goes here, but per README.md rule 4, only if three experiments already need it.

This folder sidesteps the rule because it's not an experiment — it's plumbing that unblocks autonomous execution.
