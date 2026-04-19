# exp-002b-intent-shaped-prompt

**Derived from exp-002 FAIL. Per README freeze rule: new folder, not an edit.**

## Question
Does an intent-shaped synthesis prompt ("emit 3 tools for what a user would want to accomplish on this page") produce >=50% nontrivial-tool rate on the exp-002 URL set, keeping Qwen 2.5 Coder 32B as the fixed synthesizer?

## Why
exp-002 got 0 nontrivial tools across 12 synthesis calls because the prompt asked for elements, not intents. If the prompt is the bottleneck, this experiment converts a FAIL into a PASS-with-caveat on the synthesizer side. If it's not the bottleneck, the synthesizer path is dead and THESIS goes toward Red.

## Method
1. Same 6 URLs as exp-002 (httpbin, duckduckgo, example.com, hn-item, midjourney-explore, coey-projects).
2. Qwen 2.5 Coder 32B only (Llama ignores response_format per exp-002 findings).
3. New prompt emphasizing: "what would a USER want to ACCOMPLISH here?", "emit 0-3 tools (never more)", "each tool MUST have non-empty inputSchema.properties", "reject the urge to emit one-click-per-link catalogs".
4. Same validation + nontrivial criteria as exp-002.

## Pass
- Qwen produces >=3 nontrivial tools total across the 6 URLs (vs exp-002's 0).
- Median latency unchanged or better.

## Fail
- Still 0 nontrivial tools. Synthesizer path goes Red.

## Ambiguous
- 1-2 nontrivial tools total. Signal present but weak. Logged, but branch doesn't graduate on synthesizer alone.
