# 08 — Page-by-Page Content Architecture (key pages)

All copy original, plain-English first (§9). Section orders below are the build
brief for each page; templates from `07-templates-and-blocks.md`.

## `/` Home
Hero "Machine Commerce Infrastructure" + one-sentence definition; CTAs **Start
building** (`/developers/quickstart`), **Explore Machine Commerce** → live network
indicators (live only) → "What is machine commerce?" entity block → **Lifecycle
stepper (SSR)** → Products grid (5) → How it works (Discover · Connect · Pay ·
Execute · Meter · Settle) → For developers → For AI agents → For enterprise →
On-chain proof (vault, first claim, x402-kit) → Pricing summary (live) → Resources
→ Final CTA "Build for the machine economy."

## `/product/overview`
H1 → 3 value cards (Discover · Pay per use · Settle transparently) → "Put Satelink
to work" (3 real example tasks + code) → principles → capability grid (6) →
**interactive selector**: "I'm building a [trading agent | AI agent | API product |
enterprise app] and I need [market data | RPC access | to charge per call | machine
payments]" → returns the product, a real request, its live price, a docs link →
FAQs → CTA.

## `/products/trading-intelligence` (ONLY Dodo checkout surface)
Catalog from live API, 4 metric cards, sample responses, model-vs-derived
explainer, **Starter Pack $9.99 → `/checkout?plan=starter`**, x402 $0.01/call as a
**separate rail**, full compliance disclosure. Card/UPI framed as SaaS analytics.

## `/platform/api`
Hero → What's-new carousel (changelog) → API overview → Auth & API keys → Machine
registration (HTTP 402 flow) → Products on the API → Credits & usage → x402 →
Webhooks (**Draft** unless live) → Payment flow → Errors & rate limits (real
values from docs) → Control cost → Console (Build · Deploy · Monitor · Manage,
real screenshots) → SDKs → Quickstart tabs → Technical resources → CTA.

## `/solutions/enterprise`
Hero (CTAs Talk to Satelink `/contact-sales`, Start building) → "Built for
enterprise" 4 pillars (Access & identity · Spend & usage controls · Observability &
audit · Transparent settlement — describe only what exists; roadmap = **Planned**)
→ "Two ways to work" (self-serve platform vs corporate engagement) → capabilities →
FAQ grouped (Security & compliance — **no certs claimed unless held** · Products &
capabilities · Getting started — invoicing via corporate engagement) → CTA.

## `/solutions/commerce`
H1 "Commerce infrastructure for machines" → narrative (humans buy products;
software increasingly buys services) → how teams use it → 4 benefit cards → two
sides (machine buyers / machine sellers) → capability list → "Choose how you
build" (Direct REST · x402-kit middleware MIT · SDK · MCP/agent — **Planned** if
absent) → FAQ grouped (About the offering · Trust and safety — *"What stops an
agent from paying a price that isn't real?"* → signed 402 requirements, per-key
limits, receipts) → CTA. **No market-size claims.**

## `/pricing`
H1 → audience switch (Humans · Developers · Machines & agents · Enterprise) →
product selector (Trading Intelligence · RPC) → cards (Free · Starter Pack $9.99
one-time Dodo TI-only · Pay-per-call x402/USDT **not Dodo** · Enterprise Contact
sales) → usage calculator (live prices) → compare table → per-product rate card
(live) → "How credits work" (**shared-balance disclosure unless the Dodo credit
bucket separation shipped — read the backend, state truthfully**) → x402 explainer
→ `/pricing.json` link → FAQ grouped (Plans & usage · Billing & payments · Refunds
→ `/refund`). **No recurring subscription plan while backend is one-time only.**

## `/support`
Search hero → collections (Getting started · Account · API · Machine commerce ·
Machine identity · Payments · Credits · x402 · Trading Intelligence · RPC ·
Developer platform · Billing · Security · Enterprise · Integrations ·
Troubleshooting · Status · Legal) → popular / recently updated. Seed 3–5 real
articles per collection from docs/FAQ; empty collections hidden.

## `/academy`
Hub (Courses · Tutorials · Use cases). Tutorials grouped by product. **Publish only
tutorials backed by a live endpoint; others = Draft "Available soon".** Use cases:
AI agent purchasing infra · trading agent consuming market intelligence · M2M API
payments · usage-based SaaS · API monetization · enterprise machine procurement.

## `/blog`
Category tabs (Machine Commerce · Trading Intelligence · x402 · Engineering ·
Announcements) → featured → latest grid → pagination. **Seed only real posts**
(changelog, shipped milestones, x402-kit release). No fabricated posts.

## `/login`
Cards: Developer console login · Create account · API/machine access (x402, no
account) · Docs · Pricing. Auth stays in the existing console.
