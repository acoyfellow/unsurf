# Top 100 SaaS Tools for unsurf Directory Scouting

Curated, prioritized list of 100 SaaS tools for scouting via unsurf. Each entry is rated by estimated scout difficulty and prioritized within its category for maximum directory value.

**Selection criteria**: Developer demand x scout friendliness x API richness
**Excludes**: LinkedIn, Facebook/Meta, Twitter/X, Google Workspace, Microsoft 365, Salesforce (heavy bot protection or extreme auth complexity)
**No overlap** with existing `scripts/seed-apis.json` (75 public API entries)

## Summary

| Category | Count | Easy | Medium | Hard |
|----------|-------|------|--------|------|
| CRM & Sales | 10 | 0 | 8 | 2 |
| Project Management | 10 | 2 | 7 | 1 |
| Communication | 10 | 3 | 5 | 2 |
| Analytics | 10 | 3 | 6 | 1 |
| Developer Tools | 10 | 8 | 2 | 0 |
| Marketing | 10 | 0 | 7 | 3 |
| E-commerce | 10 | 4 | 5 | 1 |
| Storage & Files | 10 | 6 | 4 | 0 |
| HR & Ops | 10 | 0 | 8 | 2 |
| AI & ML | 10 | 9 | 1 | 0 |
| **Total** | **100** | **35** | **53** | **12** |

## Difficulty Key

- **Easy**: Public-facing pages with discoverable API calls, minimal auth required
- **Medium**: SPA with background API calls, may need navigation or free trial
- **Hard**: Heavy auth walls, bot protection, or complex multi-page SPAs

---

## 1. CRM & Sales

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | HubSpot | [app.hubspot.com](https://app.hubspot.com) | medium | All-in-one CRM with marketing, sales, and service hubs |
| 2 | Pipedrive | [app.pipedrive.com](https://app.pipedrive.com) | medium | Sales-focused CRM with pipeline management |
| 3 | Close | [app.close.com](https://app.close.com) | medium | Inside sales CRM with built-in calling and email |
| 4 | Freshsales | [freshsales.io](https://freshsales.io) | medium | Freshworks CRM for sales teams with AI scoring |
| 5 | Copper | [app.copper.com](https://app.copper.com) | medium | Google Workspace-native CRM |
| 6 | Attio | [app.attio.com](https://app.attio.com) | medium | Modern data-driven CRM with flexible data model |
| 7 | Insightly | [crm.insightly.com](https://crm.insightly.com) | medium | CRM with project management and workflow automation |
| 8 | Agile CRM | [agilecrm.com](https://www.agilecrm.com) | medium | All-in-one CRM for small businesses with marketing automation |
| 9 | Zoho CRM | [zoho.com/crm](https://www.zoho.com/crm) | hard | Feature-rich CRM with extensive customization |
| 10 | Bitrix24 | [bitrix24.com](https://www.bitrix24.com) | hard | All-in-one business suite with CRM, tasks, and communication |

**Notes**: HubSpot and Pipedrive have the richest, best-documented APIs. Zoho and Bitrix24 are powerful but complex to scout due to heavy SPAs and auth requirements.

---

## 2. Project Management

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Linear | [linear.app](https://linear.app) | easy | Modern issue tracking with keyboard-first design |
| 2 | Notion | [notion.so](https://www.notion.so) | medium | All-in-one workspace for docs, wikis, and project management |
| 3 | Asana | [app.asana.com](https://app.asana.com) | medium | Work management platform for teams |
| 4 | ClickUp | [app.clickup.com](https://app.clickup.com) | medium | All-in-one productivity and project management platform |
| 5 | Monday.com | [monday.com](https://monday.com) | medium | Work OS for teams with customizable workflows |
| 6 | Height | [height.app](https://height.app) | easy | Autonomous project management with AI features |
| 7 | Basecamp | [basecamp.com](https://basecamp.com) | medium | Project management and team communication platform |
| 8 | Wrike | [wrike.com](https://www.wrike.com) | medium | Collaborative work management platform |
| 9 | Teamwork | [teamwork.com](https://www.teamwork.com) | medium | Project management for client work and agencies |
| 10 | Jira | [atlassian.com/software/jira](https://www.atlassian.com/software/jira) | hard | Enterprise issue and project tracking by Atlassian |

**Notes**: Linear has the cleanest SPA and GraphQL API -- best scout candidate. Notion's massive user base makes it high-value. Jira is the most complex but highest enterprise demand.

---

## 3. Communication

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Twilio | [twilio.com](https://www.twilio.com) | easy | Cloud communications platform for SMS, voice, and video |
| 2 | Resend | [resend.com](https://resend.com) | easy | Modern email API built for developers |
| 3 | Postmark | [postmarkapp.com](https://postmarkapp.com) | easy | Transactional email service with high deliverability |
| 4 | SendGrid | [app.sendgrid.com](https://app.sendgrid.com) | medium | Email delivery and marketing platform by Twilio |
| 5 | Mailchimp | [mailchimp.com](https://mailchimp.com) | medium | Email marketing and audience management platform |
| 6 | Intercom | [app.intercom.com](https://app.intercom.com) | medium | Customer messaging platform with bots and live chat |
| 7 | Crisp | [crisp.chat](https://crisp.chat) | medium | Business messaging platform with live chat and chatbots |
| 8 | Zendesk | [zendesk.com](https://www.zendesk.com) | medium | Customer service and engagement platform |
| 9 | Slack | [slack.com](https://slack.com) | hard | Team messaging and collaboration platform |
| 10 | Discord | [discord.com](https://discord.com) | hard | Community platform for messaging, voice, and video |

**Notes**: Twilio, Resend, and Postmark are API-first -- easiest to scout with richest endpoint discovery. Slack and Discord have high demand but complex auth and bot protection.

---

## 4. Analytics

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | PostHog | [app.posthog.com](https://app.posthog.com) | easy | Open-source product analytics with session replay and feature flags |
| 2 | Plausible | [plausible.io](https://plausible.io) | easy | Privacy-focused lightweight web analytics |
| 3 | Mixpanel | [mixpanel.com](https://mixpanel.com) | medium | Product analytics for tracking user behavior and funnels |
| 4 | Amplitude | [amplitude.com](https://amplitude.com) | medium | Digital analytics platform for product and growth teams |
| 5 | Fathom | [usefathom.com](https://usefathom.com) | easy | Simple privacy-first website analytics |
| 6 | Heap | [heap.io](https://heap.io) | medium | Digital insights platform with auto-capture analytics |
| 7 | Segment | [segment.com](https://segment.com) | medium | Customer data platform for collecting and routing analytics |
| 8 | Hotjar | [hotjar.com](https://www.hotjar.com) | medium | Heatmaps, session recordings, and user feedback tools |
| 9 | FullStory | [app.fullstory.com](https://app.fullstory.com) | medium | Digital experience intelligence with session replay |
| 10 | Datadog | [app.datadoghq.com](https://app.datadoghq.com) | hard | Infrastructure monitoring and APM platform |

**Notes**: PostHog is open-source with excellent API docs -- ideal scout target. Plausible and Fathom are simple and lightweight. Datadog has the broadest API surface but is the most complex.

---

## 5. Developer Tools

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Supabase | [supabase.com](https://supabase.com) | easy | Open-source Firebase alternative with Postgres, auth, and storage |
| 2 | Vercel | [vercel.com](https://vercel.com) | easy | Frontend deployment and serverless functions platform |
| 3 | Neon | [neon.tech](https://neon.tech) | easy | Serverless Postgres with branching and auto-scaling |
| 4 | Upstash | [upstash.com](https://upstash.com) | easy | Serverless Redis and Kafka for modern applications |
| 5 | Railway | [railway.app](https://railway.app) | easy | Infrastructure platform for deploying apps and databases |
| 6 | Netlify | [app.netlify.com](https://app.netlify.com) | easy | Web hosting and automation platform for modern web projects |
| 7 | Render | [render.com](https://render.com) | easy | Cloud platform for hosting web services and databases |
| 8 | Fly.io | [fly.io](https://fly.io) | medium | Global application deployment platform with edge computing |
| 9 | Deno Deploy | [dash.deno.com](https://dash.deno.com) | easy | Serverless edge runtime platform for Deno applications |
| 10 | PlanetScale | [planetscale.com](https://planetscale.com) | medium | Serverless MySQL platform with branching workflow |

**Notes**: This is the most scout-friendly category -- 8 of 10 are easy. These are developer-first platforms with clean SPAs and well-documented APIs. Highest expected scout success rate.

---

## 6. Marketing

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Buffer | [buffer.com](https://buffer.com) | medium | Social media scheduling and publishing platform |
| 2 | MailerLite | [app.mailerlite.com](https://app.mailerlite.com) | medium | Email marketing platform with automation and landing pages |
| 3 | ConvertKit | [app.convertkit.com](https://app.convertkit.com) | medium | Email marketing platform built for creators |
| 4 | Drip | [drip.com](https://www.drip.com) | medium | E-commerce email marketing and automation platform |
| 5 | ActiveCampaign | [activecampaign.com](https://www.activecampaign.com) | medium | Marketing automation and CRM platform |
| 6 | Unbounce | [app.unbounce.com](https://app.unbounce.com) | medium | AI-powered landing page builder for marketers |
| 7 | Hootsuite | [hootsuite.com](https://hootsuite.com) | medium | Social media management and scheduling platform |
| 8 | Ahrefs | [app.ahrefs.com](https://app.ahrefs.com) | hard | SEO toolset for backlinks, keywords, and site audits |
| 9 | SEMrush | [semrush.com](https://www.semrush.com) | hard | All-in-one SEO, content, and competitive analysis toolkit |
| 10 | Canva | [canva.com](https://www.canva.com) | hard | Visual design platform for graphics, presentations, and social media |

**Notes**: Email marketing tools (MailerLite, ConvertKit, Drip) are the best scout candidates here -- clean REST APIs with subscriber/campaign management. SEO tools (Ahrefs, SEMrush) have valuable data but heavy bot protection.

---

## 7. E-commerce

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Gumroad | [gumroad.com](https://gumroad.com) | easy | Simple platform for selling digital products |
| 2 | LemonSqueezy | [app.lemonsqueezy.com](https://app.lemonsqueezy.com) | easy | All-in-one payments and subscriptions for digital products |
| 3 | Snipcart | [app.snipcart.com](https://app.snipcart.com) | easy | Developer-first shopping cart for any website |
| 4 | Medusa | [medusajs.com](https://medusajs.com) | easy | Open-source headless commerce engine |
| 5 | Shopify | [admin.shopify.com](https://admin.shopify.com) | medium | Leading e-commerce platform for online stores |
| 6 | BigCommerce | [bigcommerce.com](https://www.bigcommerce.com) | medium | E-commerce platform for growing businesses |
| 7 | Paddle | [vendors.paddle.com](https://vendors.paddle.com) | medium | Complete payments and subscription billing for SaaS |
| 8 | Chargebee | [app.chargebee.com](https://app.chargebee.com) | medium | Subscription billing and revenue management platform |
| 9 | Square | [squareup.com](https://squareup.com) | medium | Payment processing and point-of-sale commerce platform |
| 10 | Stripe Dashboard | [dashboard.stripe.com](https://dashboard.stripe.com) | hard | Payment infrastructure platform for the internet |

**Notes**: Gumroad, LemonSqueezy, and Snipcart are developer-friendly with clean APIs. Shopify has the richest API but requires store setup. Stripe's API is legendary but dashboard scouting needs auth.

---

## 8. Storage & Files

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Cloudinary | [cloudinary.com](https://cloudinary.com) | easy | Cloud-based media management and optimization platform |
| 2 | Uploadcare | [uploadcare.com](https://uploadcare.com) | easy | File uploading, processing, and CDN delivery platform |
| 3 | ImageKit | [imagekit.io](https://imagekit.io) | easy | Real-time image and video optimization and CDN |
| 4 | Imgix | [dashboard.imgix.com](https://dashboard.imgix.com) | easy | Real-time image processing and CDN platform |
| 5 | Filestack | [filestack.com](https://www.filestack.com) | easy | File upload, transformation, and delivery API |
| 6 | Sanity | [sanity.io](https://www.sanity.io) | easy | Headless CMS with structured content and asset management |
| 7 | Dropbox | [dropbox.com](https://www.dropbox.com) | medium | Cloud file storage and synchronization platform |
| 8 | Box | [app.box.com](https://app.box.com) | medium | Enterprise cloud content management and collaboration |
| 9 | Wasabi | [console.wasabi.com](https://console.wasabi.com) | medium | S3-compatible hot cloud storage at lower cost |
| 10 | Backblaze | [backblaze.com](https://www.backblaze.com) | medium | Cloud backup and B2 object storage platform |

**Notes**: Media processing APIs (Cloudinary, ImageKit, Imgix) are highly scout-friendly with URL-based transformation APIs. Enterprise storage (Dropbox, Box) requires OAuth but has rich API surfaces.

---

## 9. HR & Ops

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | Deel | [app.deel.com](https://app.deel.com) | medium | Global payroll and compliance platform for remote teams |
| 2 | Remote | [remote.com](https://remote.com) | medium | Global HR platform for distributed teams |
| 3 | BambooHR | [bamboohr.com](https://www.bamboohr.com) | medium | HR software for small and medium businesses |
| 4 | Lattice | [lattice.com](https://lattice.com) | medium | People management platform for performance and engagement |
| 5 | 15Five | [app.15five.com](https://app.15five.com) | medium | Performance management and employee engagement platform |
| 6 | Bob | [app.hibob.com](https://app.hibob.com) | medium | Modern HR platform for mid-size companies |
| 7 | Gusto | [app.gusto.com](https://app.gusto.com) | medium | Payroll, benefits, and HR platform for small businesses |
| 8 | Personio | [app.personio.com](https://app.personio.com) | medium | All-in-one HR management platform for SMBs |
| 9 | Rippling | [app.rippling.com](https://app.rippling.com) | hard | Unified workforce management for HR, IT, and finance |
| 10 | Workday | [workday.com](https://www.workday.com) | hard | Enterprise HR and financial management platform |

**Notes**: Deel and Remote are high-priority due to the remote work trend. All HR tools are medium+ difficulty since they handle sensitive employee data. Workday is the most complex enterprise target.

---

## 10. AI & ML

| # | Name | URL | Difficulty | Description |
|---|------|-----|------------|-------------|
| 1 | OpenAI | [platform.openai.com](https://platform.openai.com) | easy | AI platform for GPT models, DALL-E, and Whisper |
| 2 | Anthropic | [console.anthropic.com](https://console.anthropic.com) | easy | AI safety company building Claude language models |
| 3 | Replicate | [replicate.com](https://replicate.com) | easy | Platform for running open-source ML models via API |
| 4 | Hugging Face | [huggingface.co](https://huggingface.co) | easy | ML model hub with inference API and model hosting |
| 5 | ElevenLabs | [elevenlabs.io](https://elevenlabs.io) | easy | AI voice synthesis and cloning platform |
| 6 | Deepgram | [console.deepgram.com](https://console.deepgram.com) | easy | AI speech-to-text and audio intelligence platform |
| 7 | AssemblyAI | [assemblyai.com](https://www.assemblyai.com) | easy | AI audio transcription and understanding platform |
| 8 | Cohere | [dashboard.cohere.com](https://dashboard.cohere.com) | easy | NLP platform for text generation, classification, and embeddings |
| 9 | Stability AI | [platform.stability.ai](https://platform.stability.ai) | easy | AI image generation platform powering Stable Diffusion |
| 10 | Runway | [app.runwayml.com](https://app.runwayml.com) | medium | AI-powered video generation and editing platform |

**Notes**: AI/ML is the easiest category to scout -- 9 of 10 are API-first platforms with clean REST APIs and excellent documentation. Highest value for the directory since AI agents are the primary unsurf consumers.

---

## Scout Priority Recommendations

### Phase 1: Quick Wins (35 easy sites)
Start with devtools (8 easy), AI (9 easy), and storage (6 easy) categories. These are API-first platforms that should yield high scout success rates and populate the directory quickly.

### Phase 2: Medium Targets (53 medium sites)
CRM, project management, communication, and marketing tools. These require more navigation but have the broadest API surfaces and highest commercial value.

### Phase 3: Hard Targets (12 hard sites)
Zoho, Bitrix24, Jira, Slack, Discord, Datadog, Ahrefs, SEMrush, Canva, Stripe, Rippling, Workday. Attempt these last -- they may need agent-scout for interactive exploration and have the highest failure risk.
