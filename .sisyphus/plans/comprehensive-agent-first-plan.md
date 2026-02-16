# unsurf Work Plan: Agent-First Infrastructure
## Comprehensive Task List — No Phases, Just Outcomes

---

## TL;DR

**Mission**: Establish unsurf as the default infrastructure for AI agents discovering and using web APIs — the "typed internet" layer.

**Approach**: Ship fast, dogfood relentlessly, learn from real usage, iterate continuously.

**Deliverables**: Reliable core tools, dense API directory, thriving agent builder community, sustainable business model.

---

## Context

### Current State
- ✅ Core architecture built (Scout → Worker → Heal)
- ✅ Effect-based reliability layer
- ✅ MCP server functional
- ✅ Cloudflare deployment working
- ✅ GoHighLevel proof point validated

### Key Insight from Dogfooding
GoHighLevel automation works: scout once → agent executes via typed API → no human login needed. This pattern scales.

### The Opportunity
Build the "typed internet" — a discoverable layer of APIs that agents can use without browser emulation. Every scouted API compounds value for all future agents.

---

## Work Objectives

### Core Objective
Make unsurf the default infrastructure for AI agents that need to interact with websites — replacing brittle browser automation with reliable typed APIs.

### Concrete Deliverables
1. Scout tool with 90%+ success rate across diverse sites
2. Heal system that auto-recovers 80%+ of API breakages
3. Directory with 100+ scouted APIs and semantic search
4. Agent framework integrations (LangChain, CrewAI, etc.)
5. Thriving community of 100+ agent builders
6. Sustainable business model (hosted tier, enterprise, or services)

### Definition of Done
- Agents run unsupervised for days without human intervention
- Directory is the first place agent builders check for APIs
- Revenue covers infrastructure costs OR sustainable open source community
- "Typed internet" is recognized concept in AI/agent space

### Must Have
- Reliable scout/heal/worker trio
- Semantic search across directory
- MCP server that just works
- Clear documentation and examples
- Community growth mechanism

### Must NOT Have (Guardrails)
- No complex UI requirements (MCP-first, API-first)
- No premature optimization for scale
- No feature bloat before core works perfectly
- No reliance on proprietary LLM features (stay portable)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Vitest, Effect test utils)
- **Automated tests**: Tests-after for new features
- **Framework**: bun test / vitest

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| API/Endpoints | Bash (curl) | Send requests, assert status + response |
| CLI/Tools | interactive_bash (tmux) | Run commands, validate output |
| Documentation | Manual review | Check examples work, links valid |

---

## Execution Strategy

### Parallel Execution Approach
Group independent tasks to maximize throughput. Target 5-8 parallel tracks. Each task = one concern.

### Dependency Matrix
High-level dependencies only:
- Core reliability must come before directory scaling
- Directory must have content before agent integrations
- Community grows after value is proven

---

## TODOs

---

### CORE RELIABILITY

#### Task 1: Scout Success Rate Audit

**What to do**:
- [ ] Identify 50 diverse websites (SaaS, e-commerce, content, dashboards)
- [ ] Run scout on each, record success/failure
- [ ] Categorize failures (auth walls, heavy JS, rate limiting, etc.)
- [ ] Create failure taxonomy document

**Must NOT do**:
- Don't optimize for edge cases yet (focus on common patterns)
- Don't add complexity for rare site types

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (investigation + analysis)
- **Skills**: Testing, data analysis

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 2, 3)
- **Blocks**: Task 6, 7

**References**:
- `src/tools/Scout.ts` — core scout implementation
- `test/Scout.test.ts` — existing test patterns
- `src/domain/NetworkEvent.ts` — what gets captured

**Acceptance Criteria**:
- [ ] CSV of 50 sites with scout results
- [ ] Document categorizing failure modes
- [ ] 70%+ sites return at least one endpoint

**QA Scenarios**:
```
Scenario: Scout common SaaS tool
Tool: Bash (curl)
Steps:
  1. curl -X POST $UNSURF_URL/tools/scout -d '{"url":"https://example.com","task":"find APIs"}'
  2. Assert response has siteId and endpointCount > 0
Expected Result: Scout returns valid result
Evidence: .sisyphus/evidence/task-1-scout-example.json

Scenario: Handle failure gracefully
Tool: Bash (curl)
Steps:
  1. Scout a site that blocks automation
  2. Assert error is clear and actionable
Expected Result: Error message explains what happened
Evidence: .sisyphus/evidence/task-1-scout-error.json
```

**Commit**: YES (groups with Task 2-5)

---

#### Task 2: Heal Effectiveness Measurement

**What to do**:
- [ ] Set up 10 automated daily workflows using worker
- [ ] Track when they break
- [ ] Measure heal success rate (did heal fix it?)
- [ ] Document healing patterns (what breaks, how it's fixed)

**Must NOT do**:
- Don't manually fix breakages (let heal try first)
- Don't skip transient failures (track retry success)

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (monitoring + analysis)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 1, 3)
- **Blocks**: Task 6, 8

**References**:
- `src/tools/Heal.ts` — heal implementation
- `src/tools/Worker.ts` — worker for replays

**Acceptance Criteria**:
- [ ] 10 workflows running for 14 days
- [ ] Log of all breakages and heal attempts
- [ ] 60%+ heal success rate (initial target)

**QA Scenarios**:
```
Scenario: Heal fixes broken path
Tool: Bash (curl)
Steps:
  1. Run worker with known-good pathId
  2. Simulate failure (wait for real or force error)
  3. Call heal with pathId and error
  4. Assert healed=true or newPathId returned
Expected Result: Heal returns working path
Evidence: .sisyphus/evidence/task-2-heal-success.json
```

---

#### Task 3: Error Message Improvement

**What to do**:
- [ ] Review all error types in `src/domain/Errors.ts`
- [ ] Ensure each error has actionable message for agents
- [ ] Add context to errors (what was being attempted, what went wrong)
- [ ] Test error messages with real agent prompts

**Must NOT do**:
- Don't expose internal stack traces
- Don't make messages too verbose for LLM context

**Recommended Agent Profile**:
- **Category**: `quick` (focused improvements)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 1, 2)

**References**:
- `src/domain/Errors.ts` — all error types
- `src/tools/Scout.ts` — where errors originate
- `src/tools/Worker.ts` — worker errors

**Acceptance Criteria**:
- [ ] Every error type reviewed and improved
- [ ] Agent can understand error and take action from message alone
- [ ] Error messages under 200 tokens for LLM efficiency

---

#### Task 4: Scout Auth Support

**What to do**:
- [ ] Add support for passing cookies in scout request
- [ ] Add support for custom headers (Authorization, etc.)
- [ ] Ensure auth tokens aren't persisted to DB
- [ ] Document auth patterns for common SaaS tools

**Must NOT do**:
- Don't store auth tokens in D1/R2
- Don't support OAuth flows (too complex for v1)

**Recommended Agent Profile**:
- **Category**: `deep` (security-sensitive)

**Parallelization**:
- **Can Run In Parallel**: YES
- **Blocks**: Task 21 (authenticated API examples)

**References**:
- `src/tools/Scout.ts` — scout input types
- `src/services/Browser.ts` — where auth would be used
- `src/db/schema.ts` — ensure no auth in schema

**Acceptance Criteria**:
- [ ] Can scout authenticated sites (test with personal accounts)
- [ ] Auth tokens not in DB
- [ ] Documentation for common auth patterns

---

#### Task 5: Scout Retry and Resilience

**What to do**:
- [ ] Add exponential backoff for transient failures
- [ ] Handle rate limiting (respect Retry-After headers)
- [ ] Add timeout handling for slow sites
- [ ] Ensure browser cleanup on failure (no zombie browsers)

**Must NOT do**:
- Don't retry permanent failures (404s, auth failures)
- Don't hammer sites that are down

**Recommended Agent Profile**:
- **Category**: `deep` (resilience patterns)

**Parallelization**:
- **Can Run In Parallel**: YES

**References**:
- Effect's `Schedule` module for retries
- `src/services/Browser.ts` for cleanup

**Acceptance Criteria**:
- [ ] Retry logic with exponential backoff
- [ ] Rate limit handling
- [ ] Resource cleanup verified

---

#### Task 6: Scout Success Rate Improvements

**What to do**:
- [ ] Based on Task 1 findings, fix top 3 failure modes
- [ ] Improve URL pattern normalization
- [ ] Better API vs non-API request filtering
- [ ] Handle SPAs with client-side routing

**Must NOT do**:
- Don't chase perfection (80/20 rule)
- Don't add complexity for rare edge cases

**Recommended Agent Profile**:
- **Category**: `deep` (complex logic)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 1)
- **Blocked By**: Task 1

**Acceptance Criteria**:
- [ ] Top 3 failure modes addressed
- [ ] Re-run Task 1 on same sites, improved success rate
- [ ] Document what was fixed

---

#### Task 7: Heal Algorithm Improvements

**What to do**:
- [ ] Analyze Task 2 data for heal failures
- [ ] Improve diff detection (what changed?)
- [ ] Better path matching (find equivalent endpoints)
- [ ] Add "heal strategy" options (conservative vs aggressive)

**Must NOT do**:
- Don't try to heal permanent site redesigns
- Don't over-complicate matching logic

**Recommended Agent Profile**:
- **Category**: `deep` (algorithmic improvements)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 2)
- **Blocked By**: Task 2

**Acceptance Criteria**:
- [ ] Heal success rate improved to 80%+
- [ ] Document heal strategies

---

### DIRECTORY & CONTENT

#### Task 8: Top 100 SaaS Scout List

**What to do**:
- [ ] Create list of 100 most-used SaaS tools by developers
- [ ] Categorize by use case (CRM, project management, marketing, etc.)
- [ ] Prioritize by scout likelihood (public APIs, non-complex auth)
- [ ] Document each tool's main use cases

**Must NOT do**:
- Don't include tools with heavy bot protection (LinkedIn, etc.)
- Don't prioritize by company size, prioritize by developer usage

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (research + organization)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 9, 10)
- **Blocks**: Task 11, 12

**Acceptance Criteria**:
- [ ] Markdown list of 100 tools with categories
- [ ] Prioritized by scout difficulty
- [ ] Published to repo

---

#### Task 9: Automated Scout Pipeline

**What to do**:
- [ ] Build script to batch scout URLs from Task 8 list
- [ ] Auto-publish successful scouts to directory
- [ ] Handle failures gracefully (log, skip, retry later)
- [ ] Store results in structured format

**Must NOT do**:
- Don't hammer sites (rate limiting between requests)
- Don't auto-publish broken/incomplete scouts

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (automation)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 8, 10)
- **Blocks**: Task 11

**References**:
- `scripts/seed.ts` — existing seeding pattern
- `src/services/Directory.ts` — publish logic

**Acceptance Criteria**:
- [ ] Script that scouts list of URLs
- [ ] Auto-publishes successful results
- [ ] Respects rate limits

---

#### Task 10: Directory UI Improvements

**What to do**:
- [ ] Improve directory landing page (`/directory`)
- [ ] Add search with filters (by capability, method count, etc.)
- [ ] Show "most popular" and "recently added" sections
- [ ] Make fingerprint data readable (nice formatting)

**Must NOT do**:
- Don't build complex frontend framework (keep it simple)
- Don't require JavaScript for basic functionality

**Recommended Agent Profile**:
- **Category**: `visual-engineering` (UI/UX)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 8, 9)
- **Blocks**: Task 13

**References**:
- `src/ui/directoryHtml.ts` — current HTML
- `src/services/Directory.ts` — data for UI

**Acceptance Criteria**:
- [ ] Searchable directory UI
- [ ] Filters working
- [ ] Mobile-friendly

---

#### Task 11: Batch Scout Execution

**What to do**:
- [ ] Run Task 9 script on Task 8 list
- [ ] Review failures, categorize patterns
- [ ] Fix any script issues
- [ ] Ensure 50+ successful scouts

**Must NOT do**:
- Don't force scout on sites that clearly block it
- Don't publish low-quality results

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (execution + QA)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 8, 9)
- **Blocked By**: Task 8, 9

**Acceptance Criteria**:
- [ ] 50+ APIs in directory
- [ ] Document of what worked/didn't work

---

#### Task 12: Real-World Use Case Documentation

**What to do**:
- [ ] For 10 scouted APIs, document real-world automation use cases
- [ ] Show before/after (manual vs automated)
- [ ] Include code examples (agent prompts, worker calls)
- [ ] Publish as blog posts or docs

**Must NOT do**:
- Don't write generic "this could be used for..." content
- Don't document APIs you haven't actually used

**Recommended Agent Profile**:
- **Category**: `writing` (documentation + examples)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 11)
- **Blocked By**: Task 11

**Acceptance Criteria**:
- [ ] 10 use case documents
- [ ] Each includes working code example
- [ ] Published and shareable

---

#### Task 13: Directory Growth Marketing

**What to do**:
- [ ] Create "Typed Internet Explorer" landing page
- [ ] Write announcement blog post
- [ ] Share on Twitter, HN, Reddit
- [ ] Reach out to newsletter writers

**Must NOT do**:
- Don't oversell capabilities
- Don't spam communities

**Recommended Agent Profile**:
- **Category**: `writing` (marketing content)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 10, 11)
- **Blocked By**: Task 10, 11

**Acceptance Criteria**:
- [ ] Landing page live
- [ ] Blog post published
- [ ] 1000+ directory visitors tracked

---

### AGENT EXPERIENCE

#### Task 14: LangChain Integration

**What to do**:
- [ ] Create LangChain tools for scout/worker/heal
- [ ] Build agent toolkit (pre-configured agent with unsurf tools)
- [ ] Publish to LangChain community
- [ ] Document usage with examples

**Must NOT do**:
- Don't require LangChain for core usage
- Don't add heavy dependencies

**Recommended Agent Profile**:
- **Category**: `deep` (integration work)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 15, 16)
- **Blocks**: Task 19

**Acceptance Criteria**:
- [ ] LangChain tools published
- [ ] Working example agent
- [ ] Documentation complete

---

#### Task 15: CrewAI Integration

**What to do**:
- [ ] Create CrewAI tools for unsurf
- [ ] Build example crew that uses unsurf for research
- [ ] Document integration

**Must NOT do**:
- Same constraints as Task 14

**Recommended Agent Profile**:
- **Category**: `deep`

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 14, 16)

---

#### Task 16: AutoGPT/General Agent Integration

**What to do**:
- [ ] Create generic agent integration (not framework-specific)
- [ ] MCP-focused (agents use MCP server directly)
- [ ] Document best practices

**Must NOT do**:
- Don't over-abstract

**Recommended Agent Profile**:
- **Category**: `deep`

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 14, 15)

---

#### Task 17: MCP Tool Description Optimization

**What to do**:
- [ ] Review current MCP tool descriptions
- [ ] Optimize for LLM comprehension (clear, concise)
- [ ] Add examples in descriptions
- [ ] Test with real agents (Claude, etc.)

**Must NOT do**:
- Don't make descriptions too long (token cost)
- Don't be ambiguous

**Recommended Agent Profile**:
- **Category**: `writing` (technical writing)

**Parallelization**:
- **Can Run In Parallel**: YES

**References**:
- `src/mcp.ts` — MCP server implementation

**Acceptance Criteria**:
- [ ] Tool descriptions reviewed and improved
- [ ] Tested with at least 2 different LLMs
- [ ] Agents use tools correctly without confusion

---

#### Task 18: Agent Debugging Dashboard

**What to do**:
- [ ] Create simple dashboard showing recent agent activity
- [ ] Log scout/worker/heal calls
- [ ] Show success/failure rates
- [ ] Enable debugging (see what agents tried)

**Must NOT do**:
- Don't require complex auth (simple API key or public)
- Don't store sensitive data

**Recommended Agent Profile**:
- **Category**: `visual-engineering`

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 14-17)

**Acceptance Criteria**:
- [ ] Dashboard accessible
- [ ] Recent activity visible
- [ ] Debugging info helpful

---

### COMMUNITY & ECOSYSTEM

#### Task 19: Discord Community Launch

**What to do**:
- [ ] Create Discord server
- [ ] Set up channels (general, help, show-and-tell, api-directory)
- [ ] Write welcome message and rules
- [ ] Invite early users

**Must NOT do**:
- Don't let it become a ghost town (seed with content)
- Don't allow spam

**Recommended Agent Profile**:
- **Category**: `unspecified-low` (community management)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 18, 20)
- **Blocks**: Task 22

**Acceptance Criteria**:
- [ ] Discord server live
- [ ] 50+ members
- [ ] Active daily conversation

---

#### Task 20: Awesome-Unsurf Repository

**What to do**:
- [ ] Create curated list repo (like awesome-python)
- [ ] Categories: tools, examples, integrations, articles
- [ ] Seed with existing content
- [ ] Promote contributions

**Must NOT do**:
- Don't include broken/outdated examples
- Don't let quality drop

**Recommended Agent Profile**:
- **Category**: `writing`

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 18, 19)

**Acceptance Criteria**:
- [ ] Repo created with initial content
- [ ] 10+ examples listed
- [ ] Contribution guidelines

---

#### Task 21: Community Examples Program

**What to do**:
- [ ] Encourage community to share use cases
- [ ] Create template for submissions
- [ ] Review and curate submissions
- [ ] Feature best examples

**Must NOT do**:
- Don't accept low-quality examples
- Don't ignore contributors

**Recommended Agent Profile**:
- **Category**: `unspecified-low` (community curation)

**Parallelization**:
- **Can Run In Parallel**: NO (ongoing)
- **Blocked By**: Task 19, 20

**Acceptance Criteria**:
- [ ] 5+ community-contributed examples
- [ ] Featured on awesome-unsurf
- [ ] Contributors acknowledged

---

### PROTOCOL & STANDARDIZATION

#### Task 22: Open Specification Document

**What to do**:
- [ ] Document the "scouted API" format
- [ ] Define fingerprint schema
- [ ] Specify directory API
- [ ] Create version strategy

**Must NOT do**:
- Don't over-engineer v1
- Don't break existing implementations

**Recommended Agent Profile**:
- **Category**: `writing` (technical specification)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on prior learnings)

**Acceptance Criteria**:
- [ ] Spec document published
- [ ] Schema definitions complete
- [ ] Versioning strategy defined

---

#### Task 23: Federation Design

**What to do**:
- [ ] Design how self-hosted directories federate
- [ ] Sync protocol (pull, push, or both?)
- [ ] Conflict resolution
- [ ] Privacy considerations

**Must NOT do**:
- Don't require federation for basic usage
- Don't compromise privacy

**Recommended Agent Profile**:
- **Category**: `deep` (distributed systems)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 22)

**Acceptance Criteria**:
- [ ] Federation design doc
- [ ] Proof of concept working

---

#### Task 24: API Validation Tools

**What to do**:
- [ ] Build tool to verify scouted APIs still work
- [ ] Test against stored schemas
- [ ] Report drift/differences
- [ ] Auto-mark stale APIs

**Must NOT do**:
- Don't spam APIs with validation requests
- Don't break user workflows

**Recommended Agent Profile**:
- **Category**: `deep`

**Parallelization**:
- **Can Run In Parallel**: YES

---

### BUSINESS MODEL

#### Task 25: Hosted Tier Planning

**What to do**:
- [ ] Define hosted tier offering
- [ ] Pricing model (per call, per month, per agent?)
- [ ] SLA considerations
- [ ] Infrastructure costs estimation

**Must NOT do**:
- Don't promise what you can't deliver
- Don't price too low

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (business strategy)

**Parallelization**:
- **Can Run In Parallel**: YES

**Acceptance Criteria**:
- [ ] Pricing page mockup
- [ ] Cost analysis
- [ ] Go/no-go decision

---

#### Task 26: Enterprise Features Planning

**What to do**:
- [ ] Identify enterprise requirements (SSO, audit logs, etc.)
- [ ] Private directory features
- [ ] Support offerings
- [ ] Pricing

**Must NOT do**:
- Don't build before there's demand

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (business strategy)

**Parallelization**:
- **Can Run In Parallel**: YES (with Task 25)

---

#### Task 27: Revenue Model Decision

**What to do**:
- [ ] Evaluate options: hosted, enterprise, services, open source
- [ ] Make decision based on traction and capacity
- [ ] Document strategy

**Must NOT do**:
- Don't force monetization before value is proven

**Recommended Agent Profile**:
- **Category**: `unspecified-high` (strategy)

**Parallelization**:
- **Can Run In Parallel**: NO (depends on Task 25, 26)

**Acceptance Criteria**:
- [ ] Decision documented
- [ ] Plan for implementation

---

### CONTINUOUS IMPROVEMENT

#### Task 28: Documentation Site Improvements

**What to do**:
- [ ] Review existing docs (README, tutorial, guides)
- [ ] Fill gaps identified during dogfooding
- [ ] Add more examples
- [ ] Video tutorials (optional but nice)

**Must NOT do**:
- Don't let docs get stale
- Don't duplicate information

**Recommended Agent Profile**:
- **Category**: `writing` (ongoing)

**Parallelization**:
- **Can Run In Parallel**: YES (continuous)

---

#### Task 29: Performance Optimization

**What to do**:
- [ ] Profile scout execution time
- [ ] Optimize slow operations
- [ ] Reduce worker latency
- [ ] Cache frequently accessed data

**Must NOT do**:
- Don't optimize prematurely
- Don't add complexity for marginal gains

**Recommended Agent Profile**:
- **Category**: `deep` (performance)

**Parallelization**:
- **Can Run In Parallel**: YES (continuous)

---

#### Task 30: Security Hardening

**What to do**:
- [ ] Security audit of codebase
- [ ] Ensure no secrets in logs
- [ ] Rate limiting to prevent abuse
- [ ] Input validation review

**Must NOT do**:
- Don't ignore security
- Don't break functionality

**Recommended Agent Profile**:
- **Category**: `deep` (security)

**Parallelization**:
- **Can Run In Parallel**: YES (continuous)

---

## Final Verification Wave

After all implementation tasks:

### F1. Plan Compliance Audit — `oracle`
Review all "Must Have" deliverables. Verify each exists and works. Check "Must NOT Have" list for violations.

### F2. Real Usage Validation — `unspecified-high`
Actually use unsurf for real automations. Dogfood everything. Document friction points.

### F3. Community Health Check — `unspecified-high`
Review community metrics. Discord activity. Contributions. Directory growth.

### F4. Business Model Validation — `deep`
If monetization attempted, verify customers exist and are happy.

---

## How to Use This Plan

1. **Pick tasks** based on current priorities and capacity
2. **Run in parallel** where possible (see dependencies)
3. **Complete tasks** fully before moving on (definition of done matters)
4. **Adjust** as learnings emerge (this is a living document)
5. **Ship continuously** — don't wait for "phases"

---

## Success Metrics (Track Continuously)

| Metric | Current | Target |
|--------|---------|--------|
| Scout success rate | ? | 90%+ |
| Heal success rate | ? | 80%+ |
| APIs in directory | ? | 100+ |
| Directory visitors | ? | 1000+/month |
| Community members | ? | 100+ |
| Real-world automations | ? | 20+ documented |
| GitHub stars | ? | 1000+ |

---

*This plan is comprehensive. You won't complete every task. Pick what matters most for your current context and constraints. The goal is progress, not perfection.*
