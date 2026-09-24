# 10 — Internal Link Graph

Encoded as CMS relationships; "Related" blocks render from them. §11.

## Seed relationships
| From | Related |
| --- | --- |
| Machine Commerce | x402 · API · Credits · Payments · Machine Identity · Trading Intelligence · RPC |
| Trading Intelligence | API · Pricing · x402 · Docs · Academy (Use Trading Intelligence) |
| Enterprise | Security · API · Billing · Machine Identity · Support · Contact sales |
| Every tutorial | its product page · docs page · API page |
| Every article | ≥1 product · ≥1 solution · docs · academy |

## CI checks (`link-graph`, blocking)
- **No orphans:** every published page has ≥2 inbound internal links.
- **No broken internal links.**
Implemented with `@satelink/seo` `checkLinkGraph` over the built route set +
CMS relationship graph. Fails the build on violation.

## Rendering
Relationship fields (`relatedProducts`, `relatedSolutions`, `relatedResources`)
on every collection → `relatedContent` block. Nav/footer inbound links count
toward the ≥2 threshold, but each content page must also carry ≥1 in-body related
link so the graph is meaningful, not just chrome.
