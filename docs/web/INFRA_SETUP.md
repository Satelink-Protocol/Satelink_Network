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

### App subdomains — Cloudflare (satelink.network zone)
Every subdomain the app's own middleware routes on (`apps/web/src/middleware.ts`
`SUBDOMAIN_MAP`) needs its own real CNAME — the middleware only rewrites paths
*after* the request already reaches Vercel under that hostname; it cannot
invent DNS. **All Vercel-pointed records are DNS only (grey cloud)** — never
proxy them (see the general rule below).
```
Type   Name        Content                  TTL   Proxy                Status
CNAME  admin       cname.vercel-dns.com     Auto  DNS only (grey cloud) already set
CNAME  developer   cname.vercel-dns.com     Auto  DNS only (grey cloud) needed
CNAME  machine     cname.vercel-dns.com     Auto  DNS only (grey cloud) needed
CNAME  node        cname.vercel-dns.com     Auto  DNS only (grey cloud) needed
CNAME  status      cname.vercel-dns.com     Auto  DNS only (grey cloud) needed
CNAME  ops         cname.vercel-dns.com     Auto  DNS only (grey cloud) needed
CNAME  docs        custom.mintlify.com      Auto  DNS only (grey cloud) needed — EXTERNAL (Mintlify), not Vercel
```
After each CNAME is added, also add that exact subdomain in the Vercel
project's **Settings → Domains** (except `docs`, which points to Mintlify, not
Vercel — Mintlify's own dashboard handles its cert). `admin.satelink.network`
is the one already live; the rest are the same pattern, not yet added.

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

### Resend — sending domain (satelink.network zone, Cloudflare)
Add the sending domain in the Resend dashboard first (**Domains → Add
Domain → satelink.network**) — Resend then generates the exact DKIM value for
your account; do not guess or reuse another project's DKIM key. Record shapes
(names are Resend's documented convention; substitute the exact `content`
Resend's dashboard shows for your domain):
```
Type   Name                          Content                              TTL   Proxy
TXT    send.satelink.network         "v=spf1 include:amazonses.com ~all"  Auto  DNS only (grey cloud)
CNAME  resend._domainkey             <exact value from Resend dashboard>  Auto  DNS only (grey cloud)
TXT    _dmarc.satelink.network       "v=DMARC1; p=none; rua=mailto:<founder-monitoring-inbox>"  Auto  DNS only (grey cloud)
```
Notes:
- **SPF** — Resend's dashboard gives the exact `send.` subdomain and the SPF
  value to use; the shape above is Resend's documented default. Confirm the
  exact host/value shown in your dashboard before adding.
- **DKIM** — always exact-copy from the dashboard; it's a per-domain generated
  key, never reusable across accounts or projects.
- **DMARC** — start at `p=none` (monitor-only, safest first step — never
  starts rejecting mail) and tighten to `p=quarantine`/`p=reject` only after
  confirming SPF/DKIM pass consistently in DMARC reports over a few weeks.
- **Proxy status: all mail-related records (SPF/DKIM/DMARC TXT and CNAME)
  must be DNS only (grey cloud), never proxied (orange cloud)** — Cloudflare's
  proxy does not apply to TXT/mail-signing records the way it does to
  web traffic, and proxying can break mail-authentication lookups.

### Vercel domain verification TXT (if Vercel requests one)
When adding `satelink.network` or a new subdomain to a Vercel project, Vercel
sometimes asks for a one-time ownership-verification TXT record before
issuing the certificate:
```
Type   Name                     Content                          TTL   Proxy
TXT    _vercel.satelink.network <exact value from Vercel's Domains tab>  Auto  DNS only (grey cloud)
```
This is temporary — Vercel's own UI states when it's safe to remove after
verification completes. Always DNS only, never proxied.

### General Cloudflare proxy-status rule for this project
**Every record above is DNS only (grey cloud) — nothing on either zone should
ever be proxied (orange cloud).** Vercel terminates TLS and handles routing
itself (a Cloudflare proxy in front adds a hop with no benefit and has caused
cert/redirect issues on similar Next.js-on-Vercel setups); mail-authentication
records break under Cloudflare's proxy regardless of provider. `/console` is a
**path** on the main `satelink.network` domain (P6), not a subdomain — it
needs no separate DNS entry; only the hostnames actually listed in
`SUBDOMAIN_MAP` above do.

---

## 4. What I can run now on your go
- **Railway (authenticated):** the §1 SQL against `Postgres-iQeW`. I've held off because it's DDL on the production instance; say "run the CMS DB SQL" and I will.
- **Vercel (authenticated as `satelink`):** create the two projects + set env. Held off until the apps exist (Phase 4/11) so the projects link to real dirs.
- **DNS:** registrar/Cloudflare access needed — these stay founder actions.

---

# web-v3-experience — founder checklist (auth, plans, env)

These are the founder actions to light up P3.B (plans) and P5 (auth). Nothing here
is executed during the build; the web ships behind flags so it is safe to defer.
Flip `NEXT_PUBLIC_PLANS_ENABLED` / `NEXT_PUBLIC_AUTH_ENABLED` only after the
matching Track B backend (`feat/api-auth-and-plans`) is deployed.

Namespace (founder-confirmed 2026-09-23): Better Auth mounts at **`/api/identity/*`**,
never `/api/auth` — that path is already owned by the existing node/operator auth
router (`createUnifiedAuthRouter`), so this avoids any collision. Every callback URL
below uses `/api/identity/callback/...`, not `/api/auth/callback/...`.

## A. Google — Sign in with Google (OAuth 2.0)
1. Google Cloud Console → create/select a project → **APIs & Services → OAuth consent screen**: External; app name "Satelink"; support email; app logo; **Privacy policy URL** `https://satelink.network/privacy`, **Terms URL** `https://satelink.network/terms`; **Authorised domain** `satelink.network`.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorised redirect URIs (derive host from env; Better Auth callback path):
     - Production: `https://api.satelink.network/api/identity/callback/google`
     - Preview: `https://<preview-host>/api/identity/callback/google`
3. Copy **Client ID** and **Client secret** → env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (apps/api).

## B. Apple — out for now (A6, 2026-09-23)
Sign in with Apple was removed from the UI, config, and tests. Supported
sign-in is Google + email (password with verification, magic link). If Apple
is revisited later, treat it as new scope, not a resurrection of dead code —
none was kept behind a flag (removal was small enough not to warrant one).

## C. Resend — transactional email
1. Add and verify the sending domain in Resend; add the **SPF, DKIM, and DMARC** DNS records it provides.
2. Sender: `no-reply@satelink.network`. Env: `RESEND_API_KEY` (apps/api). If unset, email auth is **disabled with a clear message** — never silently log-only.

## D. Dodo — subscription products (TEST MODE only)
Create Pro ($19/mo, $190/yr) and Max ($79/mo, $790/yr) subscription products plus the
$50/$200 credit packs in **Dodo test mode**. Do **not** create live-mode products until
after founder approval (§9). Wire the webhook to the Track B handler.

## E. Vercel
- Ensure **Vercel Pro** (for Web Analytics + preview budgets). Web Analytics is cookieless.

## F. Environment variables (per app, preview + production)
- apps/api (Track B): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DODO_API_KEY` (test), `DODO_WEBHOOK_SECRET`, `PLANS_ENABLED`.
- apps/web: `NEXT_PUBLIC_AUTH_ENABLED`, `NEXT_PUBLIC_PLANS_ENABLED` (both `false` until the backend is live), and the existing `NEXT_PUBLIC_DODO_CREDIT_PACKS`.
