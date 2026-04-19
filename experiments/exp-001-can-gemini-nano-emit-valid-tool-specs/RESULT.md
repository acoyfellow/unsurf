# exp-001 — RESULT

## Result: **BLOCKED**

Chrome's Prompt API (`LanguageModel` / Gemini Nano) is not available in the Playwright-bundled Chromium (147.0.7727.15) we used for autonomous browser automation. Probing `globalThis.LanguageModel` returned `undefined`. Specifically:

```json
{ "available": false, "reason": "LanguageModel not on globalThis" }
```

This is the expected behavior for Playwright's Chromium build:
- Prompt API is only shipped in Chrome Stable/Canary/Beta with the `#prompt-api-for-gemini-nano` and `#optimization-guide-on-device-model` flags enabled.
- The model itself (Gemini Nano, ~22GB) must be downloaded via `chrome://on-device-internals`.
- Neither is present in Playwright's headless Chromium.

To run this experiment properly, a human on a Mac with Chrome Canary + flags enabled + Nano downloaded would need to execute the harness (index.html pattern from the BRIEF) manually. The harness itself is not written because the gating test (is Nano available?) failed before it was relevant.

## Per THESIS.md

exp-001 is **non-gating.** Blocked here does NOT push the branch toward Red. The synthesizer path is validated via exp-002 + exp-002b (Workers AI Qwen), which is the ship path anyway — Nano was always an optional optimization (flag-gated, desktop-only Chrome Stable).

## What would unblock this

1. On a Mac with Chrome Stable:
   - Go to `chrome://flags/#prompt-api-for-gemini-nano` → Enabled
   - Go to `chrome://flags/#optimization-guide-on-device-model` → Enabled BypassPerfRequirement
   - Restart Chrome
   - Go to `chrome://components` and update "Optimization Guide On Device Model" (~2GB) and "On Device Model" (~22GB)
   - Verify with `await LanguageModel.availability()` in DevTools
2. Open the harness `index.html` (to be written), paste each target URL's `outerHTML` via DevTools `copy(document.documentElement.outerHTML)`, click Synthesize, observe per-URL validation.

Estimated effort: half a day on a machine with the model already downloaded; much more if it needs to be downloaded (Gemini Nano's model is 22GB and the download is slow).

## What this means for the thesis

Nothing negative. exp-001 was framed in the BRIEF as "testing the free/local/fast optimization path," not the ship path. The ship path (Workers AI via exp-002b) is already showing the synthesizer works at an ambiguous-but-positive level. If Nano eventually runs and passes, that's a cost optimization for extension users; if it never runs, the hosted/Workers AI path remains viable.

## Honesty log

- Did NOT write the harness index.html. The gating check (Nano availability) failed before the harness was needed. Writing the harness speculatively would be waste.
- Did NOT attempt to drive the user's real Chrome Stable via CDP even though the user is logged into sites — that's a different plumbing path (requires Chrome launched with `--remote-debugging-port` and the user's profile), out of scope for this autonomous run. An honest manual test is faster.
- Per AMD-003: "First step of Method becomes: probe availability. If not available, write RESULT.md as Blocked. No mock data." Done.

## Artifacts

- `probe.ts` — the single-shot availability check
- No harness written (see honesty log)
