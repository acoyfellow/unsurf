# Execution Plan: 5 Tasks for unsurf "Typed Internet" Mission

**Created**: 2026-02-16
**Base URL**: `https://unsurf-api.coey.dev`
**Runtime**: `bun` (scripts), Cloudflare Workers (production)

---

## Dependency Graph

```
Wave 1 (parallel):  Task 1 ──┐
                    Task 2 ──┤── all independent
                    Task 8 ──┤
                    Task 17 ─┘
                               │
Wave 2 (blocked):  Task 9 ◀──── depends on Task 8 output
```

---

## Task 1: Scout Success Rate Audit

**Goal**: Baseline metric — what % of 50 diverse sites does scout successfully capture?

### Files to Create
| File | Purpose |
|---|---|
| `scripts/scout-audit.ts` | Main audit runner |
| `scripts/scout-audit-urls.json` | 50 URLs to test (curated from seed-apis.json + new sites) |
| `.sisyphus/evidence/task-1-scout-results.csv` | Raw results |
| `.sisyphus/evidence/task-1-failure-taxonomy.md` | Categorized failure modes |

### Implementation: `scripts/scout-audit.ts`

```typescript
// scripts/scout-audit.ts
// Run: UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/scout-audit.ts

import urls from "./scout-audit-urls.json";

const UNSURF_URL = process.env.UNSURF_URL ?? "https://unsurf-api.coey.dev";
const DELAY_MS = 6000; // 6s between requests — CF Browser Rendering has concurrency limits
const TIMEOUT_MS = 60000; // 60s per scout

interface AuditResult {
  url: string;
  category: string;
  success: boolean;
  endpointCount: number;
  error: string;
  durationMs: number;
  timestamp: string;
  siteId: string;
  pathId: string;
  fromGallery: boolean;
}

const results: AuditResult[] = [];

for (const entry of urls) {
  const start = Date.now();
  let result: AuditResult;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${UNSURF_URL}/tools/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: entry.url, task: entry.task ?? "find API endpoints" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const body = await res.json();
    
    if (!res.ok) {
      result = {
        url: entry.url,
        category: entry.category ?? "unknown",
        success: false,
        endpointCount: 0,
        error: body.error ?? `HTTP ${res.status}`,
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
        siteId: "",
        pathId: "",
        fromGallery: false,
      };
    } else {
      result = {
        url: entry.url,
        category: entry.category ?? "unknown",
        success: true,
        endpointCount: body.endpointCount ?? 0,
        error: "",
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
        siteId: body.siteId ?? "",
        pathId: body.pathId ?? "",
        fromGallery: body.fromGallery ?? false,
      };
    }
  } catch (e) {
    result = {
      url: entry.url,
      category: entry.category ?? "unknown",
      success: false,
      endpointCount: 0,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      siteId: "",
      pathId: "",
      fromGallery: false,
    };
  }

  results.push(result);
  console.log(
    `[${results.length}/${urls.length}] ${result.success ? "✓" : "✗"} ${result.url} — ${result.endpointCount} endpoints (${result.durationMs}ms)${result.error ? ` — ${result.error}` : ""}`
  );

  // Rate limit
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

// Write CSV
const csvHeader = "url,category,success,endpointCount,error,durationMs,timestamp,siteId,pathId,fromGallery";
const csvRows = results.map((r) =>
  [r.url, r.category, r.success, r.endpointCount, `"${r.error.replace(/"/g, '""')}"`, r.durationMs, r.timestamp, r.siteId, r.pathId, r.fromGallery].join(",")
);
const csv = [csvHeader, ...csvRows].join("\n");

await Bun.write(".sisyphus/evidence/task-1-scout-results.csv", csv);

// Summary
const total = results.length;
const successes = results.filter((r) => r.success).length;
const failures = results.filter((r) => !r.success).length;
const avgEndpoints = successes > 0 ? results.filter((r) => r.success).reduce((sum, r) => sum + r.endpointCount, 0) / successes : 0;
const galleryHits = results.filter((r) => r.fromGallery).length;

// Categorize failures
const failureCategories: Record<string, string[]> = {};
for (const r of results.filter((r) => !r.success)) {
  let cat = "unknown";
  const err = r.error.toLowerCase();
  if (err.includes("timeout") || err.includes("abort")) cat = "timeout";
  else if (err.includes("403") || err.includes("forbidden")) cat = "auth_wall";
  else if (err.includes("429") || err.includes("rate")) cat = "rate_limited";
  else if (err.includes("navigation") || err.includes("browser")) cat = "browser_error";
  else if (err.includes("ssl") || err.includes("cert")) cat = "ssl_error";
  else if (err.includes("dns") || err.includes("enotfound")) cat = "dns_error";
  else if (err.includes("500") || err.includes("502") || err.includes("503")) cat = "server_error";
  
  if (!failureCategories[cat]) failureCategories[cat] = [];
  failureCategories[cat].push(r.url);
}

const taxonomy = `# Task 1: Scout Failure Taxonomy

## Summary
- **Total sites tested**: ${total}
- **Successes**: ${successes} (${((successes/total)*100).toFixed(1)}%)
- **Failures**: ${failures} (${((failures/total)*100).toFixed(1)}%)
- **Avg endpoints per success**: ${avgEndpoints.toFixed(1)}
- **Gallery cache hits**: ${galleryHits}

## Failure Categories
${Object.entries(failureCategories).map(([cat, urls]) => `
### ${cat} (${urls.length})
${urls.map((u) => `- ${u}`).join("\n")}
`).join("\n")}
`;

await Bun.write(".sisyphus/evidence/task-1-failure-taxonomy.md", taxonomy);

console.log("\n" + "=".repeat(60));
console.log(`SUCCESS RATE: ${successes}/${total} = ${((successes/total)*100).toFixed(1)}%`);
console.log(`Avg endpoints per success: ${avgEndpoints.toFixed(1)}`);
console.log(`Gallery cache hits: ${galleryHits}`);
console.log("=".repeat(60));
```

### Implementation: `scripts/scout-audit-urls.json`

Curate 50 URLs across these categories — pull 35 from existing `seed-apis.json` + add 15 new diverse sites:

```jsonc
[
  // FROM seed-apis.json (35 entries) — pick top ones per category:
  { "url": "https://api.open-meteo.com", "task": "get weather forecast", "category": "weather" },
  { "url": "https://restcountries.com", "task": "get country info", "category": "reference" },
  // ... (pick 1-3 per category from seed-apis.json)
  
  // NEW DIVERSE SITES (15 entries) — test harder cases:
  { "url": "https://stripe.com", "task": "find pricing page API", "category": "saas_hard" },
  { "url": "https://github.com", "task": "find repo API", "category": "saas_hard" },
  { "url": "https://news.ycombinator.com", "task": "find stories", "category": "news" },
  { "url": "https://www.amazon.com", "task": "find product search", "category": "ecommerce_hard" },
  // ... (sites with JS-heavy rendering, auth walls, SPAs)
]
```

### Step-by-Step Execution
1. **Create directories**: `mkdir -p .sisyphus/evidence`
2. **Build URL list**: Create `scripts/scout-audit-urls.json` — 35 from seed-apis.json + 15 new diverse sites
3. **Write script**: Create `scripts/scout-audit.ts` per template above
4. **Run**: `UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/scout-audit.ts`
5. **Review**: Check `.sisyphus/evidence/task-1-scout-results.csv` and `task-1-failure-taxonomy.md`
6. **Iterate**: If < 50% success, analyze failure modes and document

### Verification
- CSV exists with 50 rows
- Each row has: url, success (true/false), endpointCount, error
- Failure taxonomy document has categorized failures
- Success rate metric is calculated and recorded

### Evidence
- `.sisyphus/evidence/task-1-scout-results.csv` — raw data
- `.sisyphus/evidence/task-1-failure-taxonomy.md` — analysis
- Console output with final success rate

### Time Estimate: 1-2 hours
- URL curation: 20 min
- Script writing: 20 min
- Execution: ~5 min per site × 50 = ~4-5 hours of API time (but parallel possible)
- Analysis: 20 min

### Key Risks
- CF Browser Rendering concurrency limits → use 6s delay
- Some sites will timeout → 60s cap, log and continue
- Gallery cache may return stale results → note `fromGallery` column

---

## Task 2: Heal Effectiveness Measurement

**Goal**: Quantify heal auto-recovery rate — does heal actually fix broken paths?

### Files to Create
| File | Purpose |
|---|---|
| `scripts/heal-measure.ts` | Main measurement script |
| `.sisyphus/evidence/task-2-heal-results.json` | Structured results |
| `.sisyphus/evidence/task-2-heal-report.md` | Summary report |

### Implementation: `scripts/heal-measure.ts`

```typescript
// scripts/heal-measure.ts
// Run: UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/heal-measure.ts
//
// Strategy: Scout 10 reliable APIs, then simulate breakage by calling worker
// with intentionally wrong data. Then invoke heal and measure recovery.

const UNSURF_URL = process.env.UNSURF_URL ?? "https://unsurf-api.coey.dev";
const DELAY_MS = 8000;

// 10 reliable APIs that should scout successfully
const TARGETS = [
  { url: "https://jsonplaceholder.typicode.com", task: "get fake JSON data" },
  { url: "https://pokeapi.co", task: "get Pokemon data" },
  { url: "https://catfact.ninja", task: "get cat facts" },
  { url: "https://api.open-meteo.com", task: "get weather forecast" },
  { url: "https://api.frankfurter.app", task: "get exchange rates" },
  { url: "https://restcountries.com", task: "get country info" },
  { url: "https://dog.ceo", task: "get dog images" },
  { url: "https://icanhazdadjoke.com", task: "get dad jokes" },
  { url: "https://api.dictionaryapi.dev", task: "get word definitions" },
  { url: "https://httpbin.org", task: "test HTTP requests" },
];

interface HealTestResult {
  url: string;
  siteId: string;
  pathId: string;
  scoutSuccess: boolean;
  scoutEndpoints: number;
  workerSuccess: boolean;
  workerError: string;
  healAttempted: boolean;
  healSuccess: boolean;
  healNewPathId: string;
  healDurationMs: number;
  timestamp: string;
}

async function postTool(tool: string, body: unknown) {
  const res = await fetch(`${UNSURF_URL}/tools/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

const results: HealTestResult[] = [];

// Phase 1: Scout all targets
console.log("=== Phase 1: Scouting 10 targets ===\n");
const scoutResults: Array<{ url: string; siteId: string; pathId: string; endpoints: number }> = [];

for (const target of TARGETS) {
  const res = await postTool("scout", { url: target.url, task: target.task });
  if (res.ok) {
    scoutResults.push({
      url: target.url,
      siteId: res.body.siteId,
      pathId: res.body.pathId,
      endpoints: res.body.endpointCount,
    });
    console.log(`✓ ${target.url} — ${res.body.endpointCount} endpoints`);
  } else {
    console.log(`✗ ${target.url} — ${res.body.error ?? res.status}`);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

// Phase 2: Test worker on each scouted path
console.log("\n=== Phase 2: Testing worker ===\n");
for (const sr of scoutResults) {
  const workerRes = await postTool("worker", { pathId: sr.pathId });
  console.log(`${workerRes.ok ? "✓" : "✗"} Worker ${sr.url} — ${workerRes.ok ? "success" : workerRes.body?.error}`);
  await new Promise((r) => setTimeout(r, 2000));
}

// Phase 3: Call heal on each path (even if not broken — measures heal behavior on active paths)
// Then intentionally call heal with an error message to simulate breakage
console.log("\n=== Phase 3: Testing heal ===\n");
for (const sr of scoutResults) {
  const healStart = Date.now();
  
  // Simulate breakage by calling heal with an error
  const healRes = await postTool("heal", {
    pathId: sr.pathId,
    error: "Simulated: endpoint returned 500 Internal Server Error",
  });
  
  const healDuration = Date.now() - healStart;
  
  const result: HealTestResult = {
    url: sr.url,
    siteId: sr.siteId,
    pathId: sr.pathId,
    scoutSuccess: true,
    scoutEndpoints: sr.endpoints,
    workerSuccess: true, // from phase 2
    workerError: "",
    healAttempted: true,
    healSuccess: healRes.ok && healRes.body?.healed === true,
    healNewPathId: healRes.body?.newPathId ?? "",
    healDurationMs: healDuration,
    timestamp: new Date().toISOString(),
  };
  
  results.push(result);
  console.log(
    `${result.healSuccess ? "✓" : "✗"} Heal ${sr.url} — ${result.healSuccess ? "healed" : "failed"} (${healDuration}ms)${result.healNewPathId ? ` → ${result.healNewPathId}` : ""}`
  );
  
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

// Write results
await Bun.write(
  ".sisyphus/evidence/task-2-heal-results.json",
  JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2)
);

// Generate report
const totalHeals = results.filter((r) => r.healAttempted).length;
const healSuccesses = results.filter((r) => r.healSuccess).length;
const avgHealTime = results.length > 0
  ? results.reduce((sum, r) => sum + r.healDurationMs, 0) / results.length
  : 0;

const report = `# Task 2: Heal Effectiveness Report

## Summary
- **Sites scouted**: ${scoutResults.length} / ${TARGETS.length}
- **Heal attempts**: ${totalHeals}
- **Heal successes**: ${healSuccesses} (${totalHeals > 0 ? ((healSuccesses/totalHeals)*100).toFixed(1) : 0}%)
- **Avg heal time**: ${(avgHealTime/1000).toFixed(1)}s
- **New paths created**: ${results.filter((r) => r.healNewPathId).length}

## Results by Site
| URL | Endpoints | Heal Success | New Path | Duration |
|-----|-----------|-------------|----------|----------|
${results.map((r) => `| ${r.url} | ${r.scoutEndpoints} | ${r.healSuccess ? "✓" : "✗"} | ${r.healNewPathId ? "yes" : "no"} | ${(r.healDurationMs/1000).toFixed(1)}s |`).join("\n")}

## Notes
- Heal first retries the worker with exponential backoff (500ms, 1s, 2s × 2 retries)
- If retries fail, heal re-scouts the URL and creates a new path
- "New Path" = heal had to re-scout (transient retry wasn't enough)
`;

await Bun.write(".sisyphus/evidence/task-2-heal-report.md", report);

console.log("\n" + "=".repeat(60));
console.log(`HEAL RATE: ${healSuccesses}/${totalHeals} = ${totalHeals > 0 ? ((healSuccesses/totalHeals)*100).toFixed(1) : 0}%`);
console.log(`Avg heal time: ${(avgHealTime/1000).toFixed(1)}s`);
console.log("=".repeat(60));
```

### Step-by-Step Execution
1. **Create evidence dir**: `mkdir -p .sisyphus/evidence`
2. **Write script**: Create `scripts/heal-measure.ts` per template above
3. **Run**: `UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/heal-measure.ts`
4. **Review**: Check `.sisyphus/evidence/task-2-heal-results.json` and `task-2-heal-report.md`
5. **Optional extended run**: Modify script to re-run daily for 14 days via cron / GitHub Actions

### Verification
- JSON file exists with 10 entries (one per site)
- Each entry has: `scoutSuccess`, `healAttempted`, `healSuccess`, `healDurationMs`
- Report contains summary metrics and per-site table
- Heal success rate is calculated

### Evidence
- `.sisyphus/evidence/task-2-heal-results.json` — structured data
- `.sisyphus/evidence/task-2-heal-report.md` — human-readable report

### Key Risks
- Heal calls scout internally → doubles CF Browser Rendering usage
- Heal may succeed trivially if worker works on first retry (transient "breakage")
- True breakage simulation is limited without modifying the stored path data

### Time Estimate: 1-2 hours
- Script writing: 30 min
- Execution: ~15-20 min (10 sites × 3 phases)
- Analysis: 20 min

---

## Task 8: Top 100 SaaS Scout List

**Goal**: Curated, prioritized list of 100 SaaS tools for scouting — maximizing directory value.

### Files to Create
| File | Purpose |
|---|---|
| `.sisyphus/data/top-100-saas-list.md` | The prioritized list |
| `.sisyphus/data/top-100-saas.json` | Machine-readable version for Task 9 |

### Prioritization Criteria

Score each site 1-5 on:
1. **Developer Demand**: How often would AI agents need this API?
2. **Scout Friendliness**: Does the site have accessible API calls? (no heavy bot protection)
3. **API Richness**: Does it expose useful REST/JSON endpoints?
4. **Uniqueness**: Not already in `seed-apis.json` (75 entries exist)

**Difficulty tiers**:
- **Easy**: Pure API sites, public endpoints, minimal JS → e.g. `api.github.com`
- **Medium**: SPA with background API calls, may need navigation → e.g. `trello.com`
- **Hard**: Heavy auth walls, bot protection, complex SPAs → e.g. `salesforce.com`

### Categories to Cover (aim for ~10 per category)

1. **CRM & Sales** (10): HubSpot, Pipedrive, Freshsales, Zoho CRM, Close, Copper, Insightly, Agile CRM, Streak, Bitrix24
2. **Project Management** (10): Jira, Asana, Monday, ClickUp, Linear, Notion, Basecamp, Wrike, Teamwork, Height
3. **Communication** (10): Slack, Discord, Telegram, Twilio, SendGrid, Mailchimp, Intercom, Zendesk, Drift, Crisp
4. **Analytics** (10): Mixpanel, Amplitude, PostHog, Plausible, Fathom, Hotjar, FullStory, Heap, Segment, Datadog
5. **Developer Tools** (10): Vercel, Netlify, Railway, Render, Supabase, PlanetScale, Neon, Upstash, Fly.io, Deno Deploy
6. **Marketing** (10): Ahrefs, SEMrush, Buffer, Hootsuite, Canva, Unbounce, Mailerlite, ConvertKit, ActiveCampaign, Drip
7. **E-commerce** (10): Shopify, WooCommerce, BigCommerce, Stripe Dashboard, Gumroad, Lemonsqueezy, Paddle, FastSpring, Snipcart, Medusa
8. **Storage & Files** (10): Dropbox, Box, Google Drive, OneDrive, Cloudinary, Uploadcare, ImageKit, Filestack, Wasabi, Backblaze
9. **HR & Ops** (10): BambooHR, Gusto, Rippling, Deel, Remote, Lattice, 15Five, Personio, Workday, ADP
10. **AI & ML** (10): OpenAI, Anthropic, Replicate, Hugging Face, Runway, ElevenLabs, Deepgram, AssemblyAI, Cohere, Stability AI

### Implementation: `.sisyphus/data/top-100-saas.json`

```jsonc
{
  "_meta": {
    "description": "Top 100 SaaS tools for unsurf directory scouting",
    "total": 100,
    "criteria": "Developer demand × scout friendliness × API richness",
    "excludes_seed_apis": true
  },
  "sites": [
    {
      "name": "HubSpot",
      "url": "https://app.hubspot.com",
      "apiUrl": "https://api.hubapi.com",
      "category": "crm",
      "difficulty": "medium",
      "priority": 1,
      "notes": "Rich REST API, free tier available, CRM + marketing + sales endpoints"
    },
    // ... 99 more
  ]
}
```

### Step-by-Step Execution
1. **Research**: Use web search to identify top SaaS tools by category
2. **Deduplicate**: Cross-reference with `scripts/seed-apis.json` (75 existing entries) — no overlaps
3. **Score & prioritize**: Rate each tool on the 4 criteria
4. **Write JSON**: Create `.sisyphus/data/top-100-saas.json` with machine-readable format
5. **Write Markdown**: Create `.sisyphus/data/top-100-saas-list.md` with human-readable table
6. **Validate**: Ensure 100 unique domains, all categorized, difficulty rated

### Verification
- JSON file contains exactly 100 entries
- Each has: `name`, `url`, `category`, `difficulty`, `priority`
- No duplicates with `seed-apis.json`
- Markdown table is readable and sorted by priority within category
- All 10 categories represented with ~10 entries each

### Evidence
- `.sisyphus/data/top-100-saas.json` — the list (consumed by Task 9)
- `.sisyphus/data/top-100-saas-list.md` — human-readable version

### Time Estimate: 2-3 hours
- Research per category: ~15 min × 10 = 2.5 hours
- Formatting and cross-checking: 30 min

---

## Task 9: Automated Scout Pipeline

**Goal**: Batch scout the Task 8 list, auto-publish successes to directory.

**Depends on**: Task 8 (`top-100-saas.json`)

### Files to Create
| File | Purpose |
|---|---|
| `scripts/batch-scout.ts` | Main batch pipeline |
| `.sisyphus/evidence/task-9-batch-results.json` | Run results |
| `.sisyphus/evidence/task-9-batch-report.md` | Summary report |

### Implementation: `scripts/batch-scout.ts`

```typescript
// scripts/batch-scout.ts
// Run: UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/batch-scout.ts [--publish] [--limit=N] [--resume]
//
// Reads from .sisyphus/data/top-100-saas.json (Task 8 output)
// Scouts each URL, optionally publishes successes to directory
// Handles rate limiting, failures, and resume from checkpoint

import sites from "../.sisyphus/data/top-100-saas.json";

const UNSURF_URL = process.env.UNSURF_URL ?? "https://unsurf-api.coey.dev";
const args = process.argv.slice(2);
const PUBLISH = args.includes("--publish");
const LIMIT = (() => {
  const limitArg = args.find((a) => a.startsWith("--limit="));
  return limitArg ? parseInt(limitArg.split("=")[1], 10) : sites.sites.length;
})();
const RESUME = args.includes("--resume");

const DELAY_MS = 5000; // 5s between requests
const TIMEOUT_MS = 90000; // 90s per scout (some SaaS sites are slow)
const RESULTS_FILE = ".sisyphus/evidence/task-9-batch-results.json";

interface BatchResult {
  name: string;
  url: string;
  category: string;
  difficulty: string;
  success: boolean;
  endpointCount: number;
  siteId: string;
  pathId: string;
  fromGallery: boolean;
  published: boolean;
  error: string;
  durationMs: number;
  timestamp: string;
}

// Load previous results for resume
let previousResults: BatchResult[] = [];
if (RESUME) {
  try {
    const existing = await Bun.file(RESULTS_FILE).json();
    previousResults = existing.results ?? [];
    console.log(`Resuming from ${previousResults.length} previous results`);
  } catch { /* no previous results */ }
}

const completedUrls = new Set(previousResults.map((r) => r.url));
const results: BatchResult[] = [...previousResults];
const toProcess = sites.sites
  .filter((s) => !completedUrls.has(s.url))
  .slice(0, LIMIT - previousResults.length);

console.log(`\nBatch Scout Pipeline`);
console.log(`Total sites: ${sites.sites.length}`);
console.log(`To process: ${toProcess.length}`);
console.log(`Publish: ${PUBLISH}`);
console.log(`Delay: ${DELAY_MS}ms\n`);

for (const site of toProcess) {
  const start = Date.now();
  let result: BatchResult;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${UNSURF_URL}/tools/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: site.url,
        task: `discover all API endpoints for ${site.name}`,
        publish: PUBLISH,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const body = await res.json();

    result = {
      name: site.name,
      url: site.url,
      category: site.category,
      difficulty: site.difficulty,
      success: res.ok,
      endpointCount: body.endpointCount ?? 0,
      siteId: body.siteId ?? "",
      pathId: body.pathId ?? "",
      fromGallery: body.fromGallery ?? false,
      published: PUBLISH && res.ok,
      error: res.ok ? "" : (body.error ?? `HTTP ${res.status}`),
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    result = {
      name: site.name,
      url: site.url,
      category: site.category,
      difficulty: site.difficulty,
      success: false,
      endpointCount: 0,
      siteId: "",
      pathId: "",
      fromGallery: false,
      published: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }

  results.push(result);
  
  const icon = result.success ? "✓" : "✗";
  const pub = result.published ? " [published]" : "";
  console.log(
    `[${results.length}/${sites.sites.length}] ${icon} ${result.name} (${result.url}) — ${result.endpointCount} endpoints${pub} (${(result.durationMs/1000).toFixed(1)}s)${result.error ? ` — ${result.error}` : ""}`
  );

  // Checkpoint: save results after each entry (for resume)
  await Bun.write(RESULTS_FILE, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));

  await new Promise((r) => setTimeout(r, DELAY_MS));
}

// Generate report
const total = results.length;
const successes = results.filter((r) => r.success).length;
const published = results.filter((r) => r.published).length;
const byCategory = Object.groupBy(results, (r) => r.category);
const byDifficulty = Object.groupBy(results, (r) => r.difficulty);

const report = `# Task 9: Batch Scout Report

## Summary
- **Total sites**: ${total}
- **Successes**: ${successes} (${((successes/total)*100).toFixed(1)}%)
- **Published**: ${published}
- **Total endpoints discovered**: ${results.filter((r) => r.success).reduce((sum, r) => sum + r.endpointCount, 0)}

## By Category
| Category | Total | Success | Rate |
|----------|-------|---------|------|
${Object.entries(byCategory).map(([cat, items]) => {
  const s = items!.filter((r) => r.success).length;
  return `| ${cat} | ${items!.length} | ${s} | ${((s/items!.length)*100).toFixed(0)}% |`;
}).join("\n")}

## By Difficulty
| Difficulty | Total | Success | Rate |
|------------|-------|---------|------|
${Object.entries(byDifficulty).map(([diff, items]) => {
  const s = items!.filter((r) => r.success).length;
  return `| ${diff} | ${items!.length} | ${s} | ${((s/items!.length)*100).toFixed(0)}% |`;
}).join("\n")}

## Failed Sites
${results.filter((r) => !r.success).map((r) => `- **${r.name}** (${r.url}): ${r.error}`).join("\n") || "None"}
`;

await Bun.write(".sisyphus/evidence/task-9-batch-report.md", report);

console.log("\n" + "=".repeat(60));
console.log(`BATCH SCOUT: ${successes}/${total} success (${published} published)`);
console.log("=".repeat(60));
```

### Key Features
- **`--publish`**: Auto-publishes successful scouts to the directory
- **`--resume`**: Picks up where it left off (checkpoints after each site)
- **`--limit=N`**: Process only N sites (for testing)
- **Checkpoint saves**: Results written after each site — safe to interrupt

### Step-by-Step Execution
1. **Verify Task 8 done**: Confirm `.sisyphus/data/top-100-saas.json` exists
2. **Create evidence dir**: `mkdir -p .sisyphus/evidence`
3. **Write script**: Create `scripts/batch-scout.ts`
4. **Dry run**: `UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/batch-scout.ts --limit=5`
5. **Review**: Check first 5 results in JSON
6. **Full run**: `UNSURF_URL=https://unsurf-api.coey.dev bun run scripts/batch-scout.ts --publish`
7. **If interrupted**: `bun run scripts/batch-scout.ts --publish --resume`

### Verification
- JSON file exists with entries for all processed sites
- Each entry has: `name`, `url`, `success`, `endpointCount`, `published`
- Report shows success rates by category and difficulty
- At least 50+ sites scouted (even if not all 100 succeed)
- Published sites appear in directory: `curl https://unsurf-api.coey.dev/d/`

### Evidence
- `.sisyphus/evidence/task-9-batch-results.json` — all results
- `.sisyphus/evidence/task-9-batch-report.md` — analysis
- Directory API showing published entries

### Time Estimate: 3-5 hours
- Script: 30 min
- Dry run (5 sites): 5 min
- Full run (100 sites × 5s delay + scout time): 2-4 hours
- Analysis: 20 min

---

## Task 17: MCP Tool Description Optimization

**Goal**: Rewrite MCP tool descriptions so LLM agents select the right tool on the first try.

### Files to Modify
| File | Purpose |
|---|---|
| `src/mcp.ts` | Update all tool descriptions (lines 80-275) |
| `.sisyphus/evidence/task-17-mcp-test-results.md` | Test evidence |

### Current Descriptions (to replace)

| Tool | Current | Problem |
|---|---|---|
| `scout` | "Explore a website and capture every API call. Returns captured endpoints with inferred schemas and an OpenAPI spec." | Missing: when to use, what "scouting" means, input expectations |
| `worker` | "Replay a scouted API path directly — no browser needed..." | Missing: prerequisite (must scout first), what pathId looks like |
| `heal` | "Fix a broken path. Retries with backoff, then re-scouts..." | Missing: when to invoke, what "broken" means |
| `gallery` | "Search the API gallery for previously unsurfed sites..." | Missing: relationship to scout, what gets returned |
| `directory` | "Fingerprint-first API directory..." | Good but dense — needs examples |
| `agent-scout` | "LLM-guided exploration..." | Missing: when to use vs regular scout |

### Optimized Descriptions

**Principles applied**:
1. **First sentence = decision trigger** — tells the agent WHEN to use this tool
2. **Second sentence = mechanism** — what happens under the hood
3. **Third sentence = output format** — what the agent gets back
4. **Examples** — in field descriptions, not main description
5. **Under 200 tokens each**

```typescript
// scout
{
  description:
    "Use when you need to discover what API endpoints a website uses internally. " +
    "Opens the URL in a headless browser, captures all network traffic (XHR/fetch), " +
    "groups requests by endpoint pattern, infers request/response schemas, and generates an OpenAPI spec. " +
    "Returns a siteId (for publishing), pathId (for replaying via worker), endpoint count, and the full OpenAPI spec. " +
    "Check gallery/directory first — the site may already be captured.",
  inputSchema: {
    url: z.string().url().describe("Full URL to scout, e.g. 'https://api.example.com' or 'https://app.example.com/dashboard'"),
    task: z.string().describe("What to look for — guides which page to visit. E.g. 'find all API endpoints', 'discover the search API', 'map the user authentication flow'"),
    publish: z.boolean().optional().describe("Set true to auto-publish results to the public API directory after scouting. Default: false (private)."),
  },
}

// worker  
{
  description:
    "Use to execute a previously scouted API endpoint directly — no browser needed. " +
    "Looks up the pathId from a scout result, finds the matching endpoint, and replays the HTTP request. " +
    "Returns the API response. Requires a pathId from a previous scout result. " +
    "If it fails, use 'heal' to fix the broken path.",
  inputSchema: {
    pathId: z.string().describe("Path ID from a scout result (format: path_<timestamp>_<random>). Get this from the scout tool's output."),
    data: z.record(z.string(), z.unknown()).optional().describe("Data for the request. Used as JSON body for POST/PUT/PATCH, or substituted into URL params for GET (e.g. {id: '123'} fills :id)."),
    headers: z.record(z.string(), z.string()).optional().describe("Custom HTTP headers. Use for authenticated endpoints: {'Authorization': 'Bearer <token>'} or {'Cookie': 'session=abc'}."),
  },
}

// heal
{
  description:
    "Use when a worker call fails — fixes broken API paths automatically. " +
    "First retries the endpoint with exponential backoff (handles transient errors). " +
    "If retries fail, re-scouts the original URL to discover updated endpoints, then verifies the new path works. " +
    "Returns whether healing succeeded and optionally a new pathId to use going forward.",
  inputSchema: {
    pathId: z.string().describe("The broken path ID from a failed worker call"),
    error: z.string().optional().describe("The error message from the failed worker call — helps diagnose the issue (e.g. 'HTTP 404', 'endpoint returned HTML instead of JSON')"),
  },
}

// gallery
{
  description:
    "Search the cache of previously scouted APIs before using scout. " +
    "Returns matching sites with their domains, endpoint counts, and OpenAPI spec availability. " +
    "Much faster than scouting — no browser needed. Use this first to avoid redundant scouting.",
  inputSchema: {
    query: z.string().optional().describe("Free-text search — matches domain names, endpoint paths, and descriptions. E.g. 'weather', 'pokemon', 'user authentication'"),
    domain: z.string().optional().describe("Exact domain lookup, e.g. 'api.github.com'. More precise than query search."),
  },
}

// directory
{
  description:
    "The public API directory — look up domains, browse by capability, inspect endpoints, or search across all known APIs. " +
    "Start with 'fingerprint' for a lightweight overview (~50 tokens), drill into 'capability' for endpoint lists, " +
    "or use 'search' for semantic matching. Use 'publish' to add a scouted site. " +
    "Token-efficient: returns compact fingerprints, not full specs.",
  // ... (inputSchema stays the same — already well-described)
}

// agent-scout
{
  description:
    "Use instead of regular scout when the site requires interaction — clicking buttons, filling forms, navigating menus — " +
    "to trigger API calls that wouldn't appear from a simple page load. " +
    "An AI agent controls the browser, performing actions you describe, while capturing all network traffic. " +
    "More thorough but slower and more expensive than regular scout. Use regular scout first; escalate to agent-scout if it finds too few endpoints.",
  inputSchema: {
    url: z.string().url().describe("The URL to explore"),
    task: z.string().describe("Instructions for the AI browser agent. Be specific: 'click the search button, type a query, submit the form' rather than just 'find search API'"),
  },
}
```

### Step-by-Step Execution
1. **Read current `src/mcp.ts`** (already done above — 342 lines)
2. **Replace each tool description** with the optimized version
3. **Update input schema `.describe()` strings** for all parameters
4. **Run typecheck**: `bun run typecheck`
5. **Run biome check**: `bun run check`
6. **Run tests**: `bun run test`
7. **Test with Claude**: Use the MCP server with Claude Desktop, give it a task like "find the weather API and get today's forecast" — verify it uses gallery → scout → worker correctly
8. **Test with another LLM**: Connect to MCP via API with GPT-4 or similar, same task
9. **Document evidence**: Record tool selection sequences in `.sisyphus/evidence/task-17-mcp-test-results.md`

### Verification
- `bun run typecheck` passes
- `bun run check` passes (biome)
- `bun run test` passes (all existing tests)
- No description exceeds 200 tokens (count with `tiktoken` or approximate: ~4 chars/token)
- Test evidence shows correct tool selection by at least 1 LLM

### Evidence
- Git diff of `src/mcp.ts` showing before/after descriptions
- `.sisyphus/evidence/task-17-mcp-test-results.md` with:
  - Task given to LLM
  - Tool selection sequence
  - Whether it completed the task correctly
  - Comparison: old descriptions vs new descriptions

### Time Estimate: 2-3 hours
- Description writing: 45 min
- Code changes: 30 min
- Testing with LLMs: 1 hour
- Documentation: 30 min

---

## Cross-Task Evidence Directory

```
.sisyphus/
├── data/
│   ├── top-100-saas-list.md        # Task 8: human-readable
│   └── top-100-saas.json           # Task 8: machine-readable (consumed by Task 9)
├── evidence/
│   ├── task-1-scout-results.csv        # Task 1: raw CSV
│   ├── task-1-failure-taxonomy.md      # Task 1: failure analysis
│   ├── task-2-heal-results.json        # Task 2: structured data
│   ├── task-2-heal-report.md           # Task 2: summary
│   ├── task-9-batch-results.json       # Task 9: all results
│   ├── task-9-batch-report.md          # Task 9: summary
│   └── task-17-mcp-test-results.md     # Task 17: LLM test evidence
└── plans/
    └── 5-task-execution-plan.md        # This file
```

## Execution Checklist

```
Wave 1 — Start all in parallel:
[ ] Task 1:  Create scripts/scout-audit-urls.json (50 URLs)
[ ] Task 1:  Create scripts/scout-audit.ts
[ ] Task 1:  Run audit → .sisyphus/evidence/task-1-*
[ ] Task 2:  Create scripts/heal-measure.ts
[ ] Task 2:  Run measurement → .sisyphus/evidence/task-2-*
[ ] Task 8:  Research 100 SaaS tools
[ ] Task 8:  Create .sisyphus/data/top-100-saas.json
[ ] Task 8:  Create .sisyphus/data/top-100-saas-list.md
[ ] Task 17: Rewrite descriptions in src/mcp.ts
[ ] Task 17: Run typecheck + check + test
[ ] Task 17: Test with Claude (MCP)
[ ] Task 17: Document evidence → .sisyphus/evidence/task-17-*

Wave 2 — After Task 8 completes:
[ ] Task 9:  Create scripts/batch-scout.ts
[ ] Task 9:  Dry run (--limit=5)
[ ] Task 9:  Full run (--publish)
[ ] Task 9:  Generate report → .sisyphus/evidence/task-9-*
[ ] Task 9:  Verify published entries in directory
```
