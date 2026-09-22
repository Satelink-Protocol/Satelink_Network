# 05 — Header IA (CMS Navigation global)

Data-driven from the CMS `Navigation` global (groups, items, order, CTA labels/
links). **No navigation hard-coded in page components.** §6.

```
[S Satelink]  Products▾  Platform▾  Solutions▾  Pricing  Resources▾  Learn▾
                                    Docs   Log in   Contact sales   [Get started]
```

## Products ▾ (two columns + feature card)
- **Products:** Machine Commerce · Trading Intelligence · RPC Infrastructure ·
  x402 Machine Payments · API Metering
- **Get started:** Platform overview · Pricing · Status
- **Feature card:** "How a machine pays" → `/products/machine-commerce#lifecycle`

## Platform ▾
- **Build with Satelink:** API · Machine Commerce API · x402 · Metering · Credits ·
  Payments · Machine Identity · Settlement · Developer Console
- **Works with:** AI agents · MCP · Autonomous agents · Trading systems ·
  Enterprise apps · Automation platforms (→ `/platform/integrations#…`)
- **Developers:** Docs · Quickstart · SDKs · API reference

## Solutions ▾
- **By company:** Enterprise · Startups · Developers · AI-native companies
- **By use case:** AI Agents · Commerce · Machine Commerce · Trading Systems ·
  API Monetization · Automation
- **By industry:** Financial Services · AI · Software · Infrastructure ·
  Internet Services · Developer Tools · Enterprise Technology
- **Footer row:** Customer stories *(if any)* · Contact sales

## Resources ▾
Blog · Customer stories · News · Changelog · Status · Research (→ jakuraa.com)

## Learn ▾
Academy · Courses · Tutorials · Use cases · API quickstart · Support center

## Behaviour
- Mobile: full-screen drawer, accordion groups.
- Keyboard: roving focus, `Esc` closes, `aria-expanded`, hover-intent delay 150ms.
- Empty-aware: a group item bound to a collection with 0 published docs
  (Customer stories) is omitted, not shown disabled.
- a11y gate: `axe` on the nav + keyboard-nav E2E (`19-validation-suite.md`).

## Data shape (Navigation global)
```ts
type NavItem = { label: string; href: string; description?: string; badge?: string };
type NavGroup = { title: string; items: NavItem[] };
type NavMenu = { label: string; groups: NavGroup[]; featureCard?: { title: string; href: string } };
type Navigation = { menus: NavMenu[]; cta: { label: string; href: string }[]; site: "satelink" | "jakuraa" };
```
