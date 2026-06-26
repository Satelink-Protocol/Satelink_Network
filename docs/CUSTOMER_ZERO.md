# Customer Zero — Acquisition Tracker
Last verified: 2026-06-26. Single source of truth for the first paying customer.

## Status: NOT ACQUIRED (real external revenue $0.00003)

## Top lead
- **Rica Web Services** — IP `38.49.212.250`, `support@servarica.com`, AS26832, Montreal, CA.
- SDK: `python-requests`; ~2,247 calls/day; ~7 days active; classification `machine`, score ~75.
- Source: `developer_intel` (top lead by sustained call volume).

## Funnel state
| Step | State |
|---|---|
| Identified | ✅ (in `developer_intel`) |
| Outreach email | ❌ NOT SENT |
| Deposit (USDT → RevenueVault) | ❌ NOT MADE |
| Credits provisioned | ❌ 0 paid credits for this lead |
| API key issued | ❌ |
| Billed calls (`revenue_events_v2`) | ❌ |

> Note: one *other* near-Customer-Zero already deposited ~$0.60 (`api_credits`: 1 paid key,
> $0.59993 deposited, $0.00006 spent) but is not a retained/active paying customer.

## Next action
Send the outreach email to `support@servarica.com` (offer paid API key + deposit flow).

## Brevo (email) setup
- Domain verified; `BREVO_API_KEY` set in Railway (`/admin/config` → `BREVO_CONFIGURED`).
- Outreach engine: `apps/api/src/admin/jobs/outreach_engine.js`; trigger via
  `POST /admin/jobs/trigger/outreach` or `/admin/outreach/*`.

## Acquisition path (end-to-end)
1. Outreach → reply.
2. Customer deposits USDT to RevenueVault `0x80AF…` → `credit_deposits` → `api_credits` credited.
3. Provision API key (`/api/keys`) tied to the credit balance.
4. Customer routes RPC through `/rpc` with the key → billed at $0.00003/call →
   `revenue_events_v2` rows accumulate.
5. Once real revenue > $0.50 **and** signer funded → settlement can be enabled (human decision).

## Dashboards
- `GET /admin/customers/list` — paying customers + top free-tier IPs.
- `GET /admin/demand/leads` / `/admin/demand/stats` — lead pipeline.
