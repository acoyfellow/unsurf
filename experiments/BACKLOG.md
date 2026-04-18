# BACKLOG

Parking lot for questions and ideas that came up during experiments but are **out of scope for the experiment discovering them**.

## How to use this file

When running an experiment, if you notice something interesting that is *not* your experiment's question, add it here and keep going. Do not pursue it.

Format per entry:

```
## <short title>

- Found during: exp-NNN-<slug>
- Date: YYYY-MM-DD
- Category: schema | runner | synthesizer | directory | security | selectors | fingerprinting | benchmark | other
- Question: <one sentence>
- Why it matters: <one sentence>
- Proposed shape: <one sentence, or "unknown">
```

Keep entries terse. This is a lead list, not a design doc.

---

## (seed) v1 of tool-spec schema

- Found during: scaffolding
- Date: 2026-04-18
- Category: schema
- Question: When we need multi-page flows, streaming tools, or confidence scores, what does `tool-spec.v1.json` look like?
- Why it matters: v0 is deliberately thin. v1 is when real SaaS sites need coverage.
- Proposed shape: unknown — wait for three experiments to want the same thing.

## (seed) Headless synthesis vs in-tab synthesis

- Found during: scaffolding
- Date: 2026-04-18
- Category: synthesizer
- Question: Does the synthesizer live in Browser Rendering (server-side, for any client), in a Chrome extension (user's real browser, inherits auth), or both?
- Why it matters: Business model splits. Server-side = Workers AI spend. Client-side = free but only works when user has Chrome.
- Proposed shape: both; directory caches the server-side, extension does on-demand for unseen pages.
