# IA-v2 — Infrastructure Setup (founder actions)

Everything here is **documented, not executed** during the build (see
`DECISIONS.md` → "Infra provisioning stance"). The CMS is built against a local/
ephemeral Postgres so nothing blocks. Run these at the §18 delivery step (or tell
me to run the ones I'm authenticated for: Railway ✅, Vercel ✅).

---

## 1. CMS database — `satelink_cms` on the EXISTING Railway Postgres

**Do NOT create a new paid instance.** Add a database + least-privilege user to
the existing `Postgres-iQeW` instance. **Never touch the production app database
or its schema.**

Connect as the Postgres superuser (Railway → `Postgres-iQeW` → `DATABASE_URL`,
the `postgres` role) and run:

```sql
-- 1. Dedicated role for the CMS (least privilege; change the password).
CREATE ROLE satelink_cms_app WITH LOGIN PASSWORD '<STRONG_RANDOM_PW>';

-- 2. Separate database owned by that role (isolated from the app DB).
CREATE DATABASE satelink_cms OWNER satelink_cms_app;

-- 3. Lock it down: only the CMS role touches it.
REVOKE ALL ON DATABASE satelink_cms FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE satelink_cms TO satelink_cms_app;

-- 4. (Run while connected TO satelink_cms) restrict the public schema.
\connect satelink_cms
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO satelink_cms_app;
```

Payload owns its schema and runs its own migrations inside `satelink_cms` — no
manual DDL beyond the above.

**Connection string** (host/port/root from the existing instance's public URL):

```
DATABASE_URI=postgresql://satelink_cms_app:<STRONG_RANDOM_PW>@<RAILWAY_PG_HOST>:<PORT>/satelink_cms
```

### Local/CI fallback (used during the build)
```
DATABASE_URI=postgresql://postgres:postgres@localhost:5432/satelink_cms_dev
```
CI spins up an ephemeral Postgres (docker service) with this DB; Payload migrates
on boot. No production data is touched.

---

## 2. Vercel projects

Three projects under the `satelink` team (web already exists). Create via CLI
(`vercel projects add <name>` then link + set root dir) or the dashboard.

| Project | Domain | Root dir | Framework | Build cmd | Deployment protection |
| --- | --- | --- | --- | --- | --- |
| `web` (exists) | satelink.network | `apps/web` | Next.js | `next build` | off (public) |
| `satelink-cms` | admin.satelink.network | `apps/cms` | Next.js (Payload) | `next build` | **ON** (Vercel Auth) + `noindex` |
| `jakuraa-corporate` | jakuraa.com | `apps/corporate` | Next.js | `next build` | off (public) |

Monorepo note: set each project's **Root Directory** to its `apps/*` dir and
enable "Include files outside root" so workspace `packages/*` resolve. Install
command `npm install` at repo root (Turbo-aware).

### Env vars per project

**satelink-cms**
```
DATABASE_URI=<from §1>
PAYLOAD_SECRET=<STRONG_RANDOM_64_HEX>
PAYLOAD_PUBLIC_SERVER_URL=https://admin.satelink.network
BLOB_READ_WRITE_TOKEN=<Vercel Blob token>       # media adapter
CMS_REVALIDATE_SECRET=<STRONG_RANDOM>            # webhook → public revalidateTag
NEXT_PUBLIC_API_BASE=https://rpc.satelink.network
```

**web** (additions)
```
CMS_API_URL=https://admin.satelink.network/api   # public reads via REST
CMS_REVALIDATE_SECRET=<same as CMS>
NEXT_PUBLIC_DODO_CREDIT_PACKS=<prod packs, matches apps/api>
NEXT_PUBLIC_SITE_URL=https://satelink.network
```

**jakuraa-corporate**
```
CMS_API_URL=https://admin.satelink.network/api
CMS_REVALIDATE_SECRET=<same as CMS>
NEXT_PUBLIC_SITE_URL=https://jakuraa.com
```

---

## 3. DNS

### admin.satelink.network (CMS) — Cloudflare (satelink.network zone)
```
Type   Name    Value                   Proxy
CNAME  admin   cname.vercel-dns.com    DNS only (grey cloud)
```

### jakuraa.com (corporate) — at the jakuraa.com registrar
Apex + www to Vercel:
```
Type   Name   Value                    Notes
A      @      76.76.21.21              Vercel apex A record
CNAME  www    cname.vercel-dns.com     redirects to apex in Vercel
```
Then add `jakuraa.com` and `www.jakuraa.com` as domains on the
`jakuraa-corporate` Vercel project and let it issue the cert.

> jakuraa.com currently does not resolve — these records + the Vercel domain
> attach are what make it live. Add them, then verify in the Vercel project's
> Domains tab (green "Valid Configuration").

---

## 4. What I can run now on your go
- **Railway (authenticated):** the §1 SQL against `Postgres-iQeW`. I've held off because it's DDL on the production instance; say "run the CMS DB SQL" and I will.
- **Vercel (authenticated as `satelink`):** create the two projects + set env. Held off until the apps exist (Phase 4/11) so the projects link to real dirs.
- **DNS:** registrar/Cloudflare access needed — these stay founder actions.
