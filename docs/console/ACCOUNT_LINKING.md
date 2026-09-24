# Console account linking — API spec for founder review

_2026-09-24 · status: proposal, not built. Touches `api_credits` (billing identity) → founder review required before any merge._

## Why
`console.satelink.network` signs people in with Better Auth (`user` table), but every
customer data endpoint authenticates with an **API key** (`api_credits.api_key`).
Nothing links the two. The console bridges this today by holding the keys a user
connects in a Secure, httpOnly, SameSite=Strict cookie on the console host
(`apps/console/src/lib/keys.ts`). That is honest and safe, but it is per-browser and
cannot support: revoking/rotating keys, per-agent scopes and spend caps, alerts,
saved queries, per-request logs, or cross-device key lists.

## What the console already reads (no API change)
| Console surface | Endpoint | Auth |
|---|---|---|
| Overview, Keys, Agents | `GET /v1/console/summary` | API key |
| Usage, Requests (daily), Agents trend | `GET /api/keys/usage-history` | API key |
| Billing, Overview deposits | `GET /api/keys/deposits`, `GET /api/keys/deposit-info` | API key |
| Billing plans | `GET /v1/plans` | public |
| Trading Intelligence explorer/playground | `GET /v1/intelligence`, `GET /v1/intelligence/:metric` | public / API key |
| x402 | `GET /.well-known/x402` | public |
| Create key | `POST /api/keys` (free tier) | none (rate-limited) |
| Settings | Better Auth `get-session`, `list-accounts`, `list-sessions`, `revoke-session`, `revoke-other-sessions`, `sign-out` | session |

## Proposed additions (additive, flag-gated `CONSOLE_ACCOUNTS_ENABLED`)
1. **Table `console_key_links`** — `(user_id text → user.id, api_key text → api_credits.api_key, label text, created_at, revoked_at null)`, unique `(user_id, api_key)`. No change to `api_credits`.
2. **Session-authenticated router `/v1/me/*`** (Better Auth session cookie, mounted after `mountBetterAuth`):
   - `GET /v1/me/keys` — linked keys with fingerprint, tier, balance, last-used.
   - `POST /v1/me/keys` — issue a free key **and** link it (wraps `createApiKeyWithCredits`).
   - `POST /v1/me/keys/link` — link an existing key; proof = caller presents the full key once.
   - `POST /v1/me/keys/:fp/revoke` — sets `api_credits.revoked_at` (**money-path adjacent: founder review**).
   - `GET /v1/me/requests?from&to&key&status` — per-request log **only if** a request log table exists; otherwise stays absent and the console keeps its empty state.
3. **Agents** — `console_agents (id, user_id, name, api_key, scopes jsonb, spend_cap_usdt numeric null, rate_limit int null, paused bool)`; enforcement of caps/pause belongs in the RPC gateway and credit deduction → **founder review; separate PR**.
4. **Alerts** — `console_alerts (user_id, kind, threshold, channel='email', last_sent_at)` + a job that reads `api_usage_daily` and sends via Resend.
5. **Per-product meters** — split `api_usage_daily` by product (or read Pricing V2 UU meters once shipped).

## Migration of cookie-held keys
When `/v1/me/keys` ships, the console offers a one-click "Save these keys to your account" that POSTs each cookie-held key to `/v1/me/keys/link`, then clears the cookie.

## Guardrails
- Never return a full key after creation; fingerprints only.
- CSRF: session routes require `Origin` ∈ trusted origins (Better Auth `trustedOrigins` already lists the console host).
- Audit: every link/revoke/cap change writes an audit row (user, key fingerprint, action, before/after).
