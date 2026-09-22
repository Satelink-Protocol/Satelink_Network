# @satelink/cms — Payload 3 CMS

admin.satelink.network. Private, noindexed, RBAC + mandatory TOTP 2FA. Source of
content for satelink.network and jakuraa.com (read via REST + ISR).

> **Isolated from the npm workspace.** The root workspace pins React 18.2.0 (for
> apps/web); Payload 3 needs **React 19**. So `apps/cms` is excluded from the root
> `workspaces` (`"!apps/cms"`) and manages its **own** `node_modules` + lockfile.
> Never run the CMS install from the repo root — always `cd apps/cms` first.

## Setup

```bash
cd apps/cms
cp .env.example .env            # set PAYLOAD_SECRET (openssl rand -hex 32), DATABASE_URI
npm install                     # isolated install (React 19, Payload 3)

# DB: a local Postgres is running on :5432 in dev. Create the dev database once:
createdb satelink_cms_dev       # or: psql -c 'CREATE DATABASE satelink_cms_dev;'

npm run dev                     # http://localhost:3200/admin  (Payload migrates on boot)
```

Prod DB = `satelink_cms` on the existing Railway Postgres (see
`docs/web/INFRA_SETUP.md`; never the app DB). Media via Vercel Blob
(`BLOB_READ_WRITE_TOKEN`); local disk in dev.

## Phase 4 gate — CRUD + publish + rollback

```bash
cd apps/cms && npm install
DATABASE_URI=postgresql://postgres:postgres@localhost:5432/satelink_cms_dev \
  PAYLOAD_SECRET=$(openssl rand -hex 32) \
  npx vitest run test
```
`test/cms-lifecycle.int.test.ts` exercises CRUD, draft→published (publishedAt +
version), version rollback, and the truth hooks (banned phrase + Dodo scope).

## Structure
- `src/payload.config.ts` — Postgres adapter, Lexical, Blob, collections, globals.
- `src/collections/` — 25 collections (factory + explicit). `index.ts` = registry.
- `src/globals/` — Navigation, Footer, SiteSettings, SEODefaults, RobotsConfig.
- `src/access/roles.ts` — 8-role RBAC. `src/hooks/` — audit-log, truth, revalidate.
- `src/blocks/` — the page block inventory (renderers live in `@satelink/web-ui`).
- `seed/` — idempotent seed (real content only).

## Workflow
Draft → Review → Scheduled → Published → Archived. Drafts + autosave + scheduled
publish (Vercel Cron → Payload jobs). On publish → webhook → `revalidateTag` on the
public sites (`CMS_REVALIDATE_SECRET`). Every write → `audit-log` (append-only).

## Deploy
Vercel project `satelink-cms`, **deployment protection ON**, env per
`INFRA_SETUP.md`. Admin is `noindex, nofollow`.
