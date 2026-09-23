# Better Auth (Track B — P5 backend)

Customer authentication (email+password with verification, magic link, Google,
Apple, sessions, 2FA) via Better Auth, in `src/auth/better_auth.mjs`.

**Status: written, unit-tested (config gating), and INERT.** It is not mounted in
`app_factory` and does not run until the founder enables it (below). With the flag
off it imports nothing from `better-auth` and changes no existing auth or
money-path behaviour. Full provider flows are validated on the preview with real
secrets (§9), because they need OAuth credentials and the Better Auth schema.

## Enabling (founder steps)
1. **Provision secrets** (see `docs/web/INFRA_SETUP.md` for exact values): Google
   OAuth, Apple Services ID + `.p8` key, Resend domain + DNS, and set the env vars
   in `apps/api` (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_*`, `APPLE_*`,
   `RESEND_API_KEY`, `AUTH_EMAIL_FROM`).
2. **Create the schema.** Better Auth owns its schema; generate/apply it with its
   CLI against the auth database (a new `auth_*`-namespaced set is recommended,
   kept separate from the money-path tables):
   `npx @better-auth/cli generate` then `npx @better-auth/cli migrate`
   (point it at this config). Do **not** hand-write the schema — it is
   version/plugin-specific.
3. **Choose the `/api/auth` namespace.** `app_factory.mjs` already mounts
   `createUnifiedAuthRouter()` at `/api/auth`. Decide whether Better Auth owns
   `/api/auth` (mount `mountBetterAuth(app, pool)` BEFORE that router) or a
   sub-namespace, and update the web's `NEXT_PUBLIC_AUTH_ENABLED` + the OAuth
   redirect URIs accordingly. The web P5 UI expects `/api/auth/sign-in/social` and
   `/api/auth/callback/{google,apple}`.
4. **Set `AUTH_ENABLED=true`** in `apps/api` (and `NEXT_PUBLIC_AUTH_ENABLED=true`
   in `apps/web`).

## Account linking (§6.1)
A Better Auth user should map 1:1 to the existing `api_credits` account by
**verified email**. Implement this as a Better Auth `databaseHooks.user.create`
after-hook that links/creates the `api_credits` row (mirroring
`resolveOrCreateAccountForCheckout` in `internal_dodo.js`). It is intentionally
NOT wired here because it writes to a money-adjacent table and must be validated
against the live schema first. Existing API keys and wallet-linked accounts keep
working unchanged.

## Apple secret
Apple rejects client secrets valid > 6 months, so `appleClientSecret()` generates
an ES256 JWT at runtime with `jose` (~5-month expiry) from
`APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY`/`APPLE_CLIENT_ID`. The Apple
callback is `response_mode=form_post` (cross-site POST) — Better Auth sets the
state cookie `SameSite=None; Secure`; the session cookie stays `Lax` and is shared
across `.satelink.network`.

## Email
Email flows use Resend. If `RESEND_API_KEY` is absent, `emailAndPassword` is
disabled (`emailEnabled()` false) with a clear error — never silently log-only.
