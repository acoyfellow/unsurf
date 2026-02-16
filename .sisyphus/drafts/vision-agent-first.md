# Draft: unsurf — Typed Internet Infrastructure for AI Agents

## Vision Statement

**The Problem**: AI agents today interact with websites like humans did in 1995 — clicking buttons, scraping HTML, praying CSS selectors don't change. It's slow, fragile, and expensive.

**The Insight**: Every modern web app already has a typed API underneath its UI. The frontend uses it. The agent should too.

**The Vision**: A "typed internet" layer where AI agents discover, understand, and use APIs without human intervention. No browser emulation. No DOM parsing. Just structured requests and responses.

**The Product**: unsurf — Turn any website into a typed API that agents can use reliably.

---

## Core Concept: Scout → Directory → Worker

```
┌─────────────────────────────────────────────────────────────────┐
│                     THE TYPED INTERNET                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐              │
│   │  SCOUT   │────▶│ DIRECTORY│────▶│  WORKER  │              │
│   └──────────┘     └──────────┘     └──────────┘              │
│        │                  │                │                  │
│        ▼                  ▼                ▼                  │
│   "Discover          "Find API           "Use API"           │
│    the API"           by capability"                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### For AI Agents

Agents don't need to understand unsurf's internals. They just need three capabilities:

1. **scout** — "Find the API for this website"
2. **directory** — "Search for APIs that do X"
3. **worker** — "Call this API with these parameters"

### For Humans (Deployers)

Humans deploy unsurf once, then agents use it forever:

```bash
# Deploy to Cloudflare (one time)
git clone https://github.com/acoyfellow/unsurf
bun install
CLOUDFLARE_API_TOKEN=xxx bun run deploy

# Done. Now agents can:
# - Scout any website
# - Query the directory
# - Execute API calls
```

---

## Proof Point: GoHighLevel Automation

**The Workflow**: Routine tasks in GoHighLevel CRM

**Before unsurf**:
- Log in manually
- Navigate through UI
- Click buttons, fill forms
- Error-prone, time-consuming

**With unsurf**:
1. Scout GoHighLevel once → Get typed API
2. Give agent the task + API spec
3. Agent executes via worker
4. No UI interaction needed

**The Key Insight**: Once scouted, the API is **reusable forever**. Other agents can discover it via directory. The work compounds.

---

## Dogfooding Strategy: 5 Experiments to Run Now

### Experiment 1: Agent-Powered Daily Standups
**Goal**: Automate gathering project updates from multiple sources

**Setup**:
1. Scout GitHub, Linear, Slack web apps
2. Build agent that:
   - Queries directory for "project management APIs"
   - Uses worker to fetch open issues, PRs
   - Generates daily summary

**Success Metric**: Agent successfully generates standup report without human login

### Experiment 2: Competitive Intelligence Agent
**Goal**: Monitor competitor pricing/features automatically

**Setup**:
1. Scout competitor websites (pricing pages, feature lists)
2. Schedule daily worker calls
3. Alert on changes

**Success Metric**: Detected a pricing change before it was announced

### Experiment 3: Self-Healing Integration Tests
**Goal**: Prove "heal" works in production

**Setup**:
1. Scout internal staging environment
2. Run integration tests via worker
3. When tests break, trigger heal
4. Measure recovery time

**Success Metric**: Zero manual intervention for API changes

### Experiment 4: Directory Growth Hack
**Goal**: Populate directory with high-value APIs

**Setup**:
1. Identify 50 most-used SaaS tools by developers
2. Scout each one
3. Auto-publish to directory
4. Tweet/blog about each discovery

**Success Metric**: 100 APIs in directory, 1000 unique visitors

### Experiment 5: MCP-First Documentation
**Goal**: Document unsurf using unsurf

**Setup**:
1. Scout unsurf's own API
2. Give agent task: "Generate documentation for the scout tool"
3. Agent uses its own API to document itself

**Success Metric**: Agent-generated docs are good enough to publish

---

## The "Typed Internet" Directory Concept

### Current State: Gallery/Directories

You have two concepts:
- **Gallery**: Community registry of scouted sites
- **Directory**: Fingerprint-first semantic search

### Proposed Evolution: The Typed Internet

**Layer 1: Discovery** (Scout)
- Anyone can scout any site
- Results auto-published to directory (opt-out)

**Layer 2: Registry** (Directory)
- Semantic search across all scouted APIs
- Fingerprint view: "What can this domain do?"
- Capability filtering: "Show me all payment APIs"

**Layer 3: Execution** (Worker)
- Agents execute APIs directly
- Heal auto-fixes when sites change
- Usage analytics (opt-in)

**Layer 4: Ecosystem** (Future)
- Community-contributed API schemas
- Validation/testing tools
- Rate limiting/monitoring

### Key Innovation: Fingerprint-First

Instead of storing full OpenAPI specs (expensive for LLM context), store **fingerprints**:

```json
{
  "domain": "stripe.com",
  "capabilities": ["payments", "subscriptions", "invoicing"],
  "auth": "bearer",
  "methods": { "GET": 12, "POST": 8, "DELETE": 2 },
  "confidence": 94,
  "version": 3
}
```

Agents can fit **hundreds of fingerprints** in context. Only fetch full spec when needed.

---

## Go-to-Market: Agent-First

### Primary Audience: AI Agent Builders

**Persona**: Developer building autonomous agents for businesses

**Pain Points**:
- "My agent keeps breaking when websites change"
- "I spend more time maintaining selectors than building logic"
- "I can't scale past 10 integrations"

**Value Prop**: 
> "Stop scraping. Start using APIs. unsurf discovers the typed interface every website already has."

### Secondary Audience: Automation Engineers

**Persona**: Person automating repetitive business workflows

**Pain Points**:
- "I hate logging into 5 different SaaS tools every day"
- "APIs are undocumented or don't exist"
- "Zapier doesn't support my niche tool"

**Value Prop**:
> "If a human can do it in a browser, an agent can do it via API."

### Marketing Strategy

1. **Content**: Blog posts showing automations built with unsurf
2. **Community**: Discord for agent builders sharing scouted APIs
3. **Examples**: Curated list of "unsurfed APIs" (like awesome-unsurf)
4. **Partnerships**: Integrate with agent frameworks (LangChain, CrewAI)
5. **Viral**: "Typed Internet" as a meme/concept

---

## Technical Iterations (Ship Fast)

### Phase 1: Core Stability (Week 1-2)
- [ ] Ensure scout works on 90% of sites
- [ ] Fix any heal bugs
- [ ] Add basic usage analytics

### Phase 2: Directory MVP (Week 3-4)
- [ ] Improve semantic search quality
- [ ] Add "most popular" APIs
- [ ] Create simple web UI for browsing

### Phase 3: Agent Experience (Week 5-6)
- [ ] Add better error messages for agents
- [ ] Create agent debugging tools
- [ ] Publish agent framework integrations

### Phase 4: Community (Week 7-8)
- [ ] Launch "Typed Internet" landing page
- [ ] Start API submission program
- [ ] Build Discord community

---

## Open Questions

1. **Monetization**: How do you want to sustain this?
   - Hosted version with usage tiers?
   - Enterprise support?
   - Stay open source + consulting?

2. **Scope**: Should the directory be centralized or federated?
   - One global directory (unsurf.coey.dev/directory)?
   - Self-hosted directories that federate?
   - Both?

3. **Quality**: How to handle unreliable scouted APIs?
   - Community validation?
   - Automated testing?
   - Reputation scores?

4. **Privacy**: How to handle authenticated/private APIs?
   - Support for auth tokens in scout?
   - Private directories?
   - Encryption at rest?

---

## Next Steps

1. **Pick 1-2 experiments** from the list above
2. **Run them this week** — real usage beats planning
3. **Measure what matters** — agent success rate, directory growth
4. **Iterate based on learnings**

**The goal**: Get agents using unsurf in production within 7 days.

---

*This is a living document. Update as we learn.*
