# 20 — Delivery & Deployment

§18. Stacked PRs on top of the reposition PR (#401).

## Stacked PR plan
| PR | Contents | Depends on |
| --- | --- | --- |
| (base) | reposition + E2E gate | — (**PR #401**, open) |
| a | packages + CMS (`apps/cms`) | base |
| b | shell + templates (both public apps) | a |
| c | pages + content (seed) | b |
| d | jakuraa.com (`apps/corporate`) | c |
| e | machine/GEO layer (`*.json`, `.well-known`, llms, JSON-LD) | c |

Each PR: screenshots (375/768/1280, dark+light), route table, test + Lighthouse
results, comment on the PR.

## Vercel
- `web` → satelink.network (exists).
- `jakuraa-corporate` → jakuraa.com (new).
- `satelink-cms` → admin.satelink.network (new, **deployment protection ON**).
- Env vars + DNS per `INFRA_SETUP.md`. jakuraa.com DNS records printed there for
  the founder to add.

## Gate before merge — **§18 HARD STOP for founder approval**
Previews build automatically; re-run the full `19-validation-suite.md` against the
preview URLs and comment results on each PR. **Then STOP for founder approval.**

## After approval
Merge in order (a→e) → verify production → run smoke truth-lint + `seo:check`
against production. On failure: roll back the affected Vercel project to its
previous deployment and report.
