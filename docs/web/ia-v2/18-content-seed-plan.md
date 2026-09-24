# 18 — Content Seed Plan

Original copy seeded into the CMS via `apps/cms/seed/*.ts` (idempotent, run against
preview DB). §17 Phase 12. **Truth policy: seed only real, true content.**

## What gets seeded
| Collection | Seed source (real) | Publish? |
| --- | --- | --- |
| Product (5) | machine-commerce, trading-intelligence, rpc, x402, metering — original definitions | Published |
| Solution | company-size + use-case + industry pages — original | Published |
| Pricing display | from live catalog `/v1/intelligence` | Published (parity-checked) |
| Blog | changelog entries, shipped milestones, x402-kit release — **real only** | Published |
| Changelog | seed from docs `changelog.md` | Published |
| News | real announcements only | Published (else none) |
| Academy tutorials (10) | the brief's 10; **only those with a live endpoint** | Published; others Draft "Available soon" |
| Academy use cases (6) | AI agent purchasing · trading agent · M2M payments · usage SaaS · API monetization · enterprise procurement | Published |
| Support (3–5/collection) | from existing docs + FAQ | Published; empty collections hidden |
| FAQ | grouped per page (from §8/§9) | Published |
| Person | founder only ("Jakuraa, Founder") with `verifiedAt` | Published; groups w/ 0 hidden |
| JobOpening | none unless real | empty-state |
| CustomerStory / testimonials | **none** (no verified customers) | omitted, section auto-hidden |
| Navigation / Footer globals | from `05`/`06` | Published |
| Legal (acceptable-use, cookies, security, responsible-disclosure, data-processing) | drafted, **founder-approved copy** | **Review** state; linked only when Published |

## Never seeded (truth policy §2)
Customers, logos, testimonials, revenue, user counts, API volume, uptime,
benchmarks, certifications, employees beyond the founder, funding, investors,
partners, case studies, market statistics.

## Idempotency
Seed keyed by `(site, type, slug)` upsert; re-running updates, never duplicates.
Runs against the preview DB; production seeding is a founder action at §18.
