# 06 — Footer IA (CMS Footer global)

Data-driven from the CMS `Footer` global (columns, links, social, legal). §7.

## Columns
| Products | Platform | Solutions | Industries | Developers | Resources |
| --- | --- | --- | --- | --- | --- |
| Machine Commerce | Overview | Enterprise | Financial services | Documentation | Blog |
| Trading Intelligence | API | Startups | AI | Quickstart | Customer stories* |
| RPC Infrastructure | x402 | Developers | Software | API reference | News |
| x402 Machine Payments | Machine identity | AI agents | Infrastructure | SDKs | Changelog |
| API Metering | Metering & credits | Commerce | Developer tools | Console | Academy |
| Pricing | Payments | Trading systems | Enterprise technology | x402-kit (GitHub) | Tutorials |
| Log in | Settlement | API monetization | | | Use cases |
| | Integrations | Automation | | | |

## Secondary rows
- **Help and security:** Support center · Status · Security · Report abuse ·
  Responsible disclosure · Network (run a node)
- **Company (→ jakuraa.com):** Jakuraa · Leadership · Mission · Research · News · Careers · Contact
- **Terms and policies:** Privacy policy · Terms of service · Refund & cancellation ·
  Acceptable use policy · Cookie policy · Data processing

`*` Customer stories hidden when empty. Legal pages not yet Published are omitted
until Published (§7).

## Bottom bar
© `<year>` Jakuraa Commercial Pvt Ltd · registered address (from
`@satelink/content` `LEGAL_ENTITY`) · social links (CMS) · theme toggle.

## Cross-links
satelink.network footer "Company" column → jakuraa.com; jakuraa.com "Products" →
satelink.network. Organization JSON-LD (`@satelink/seo`) carries `legalName`,
`address`, `founder`, `brand: Satelink`, `sameAs`.

## Data shape (Footer global)
```ts
type FooterLink = { label: string; href: string; hideWhenEmptyCollection?: string };
type FooterColumn = { title: string; links: FooterLink[] };
type Footer = { columns: FooterColumn[]; secondary: FooterColumn[]; social: { platform: string; href: string }[]; site: "satelink" | "jakuraa" };
```
