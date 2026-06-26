# Admin Dashboard Wiring Guide
For Antigravity (or any client) connecting the admin control room to the backend.
Last verified: 2026-06-26.

## Auth pattern
All admin observer endpoints require `X-Admin-Token`. The browser never sees the token:
the Next.js route `apps/web/src/app/api/admin-proxy/route.js` injects `ADMIN_TOKEN`
server-side and forwards to `${API_BASE}/admin/*`.

Client usage:
```js
const adminFetch = (path, opts = {}) =>
  fetch('/api/admin-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, method: opts.method || 'GET', body: opts.body }),
  }).then(r => r.json());

// SSE: new EventSource('/api/admin-proxy?stream=live/feed')
```

## Response contract
- Success: `{ ok: true, data: { … }, ts: <epoch_ms> }`
- Error: `{ ok: false, error: <string>, ts: <epoch_ms> }`
(Pre-existing live endpoints like `/intel/developers` use their original shapes, e.g.
`{ ok, developers, count }` — see `docs/API_REFERENCE.md`.)

## 18 dashboard pages → backend endpoints
| Page | Backend endpoint | Status | Primary data key |
|---|---|---|---|
| Executive | `GET /admin/executive/summary` | Observer (new) | `data` (KPIs + top_risks) |
| Revenue | `GET /admin/revenue/summary` | Observer (new) | `data.total_real_usdt` |
| Revenue events | `GET /admin/revenue/events` | Observer (new) | `data.events[]` |
| Revenue funnel | `GET /admin/revenue/funnel` | Observer (new) | `data.settled_usdt` |
| Demand leads | `GET /admin/demand/leads` | Observer (alias) | `data.developers[]` |
| Demand stats | `GET /admin/demand/stats` | Observer (new) | `data` |
| Network | `GET /admin/network/health` | Observer (new) | `data.availability_pct` |
| Nodes | `GET /admin/nodes/list` | Observer (new) | `data.nodes[]` |
| Billing | `GET /admin/billing/credits` | Observer (new) | `data` |
| Treasury | `GET /admin/treasury/status` | Observer (new) | `data` (+ `/admin/settlement/status` live) |
| Customers | `GET /admin/customers/list` | Observer (new) | `data.paying[]` |
| Agents | `GET /admin/agents/status` | Observer (new) | `data.agents_service` (FAILED) |
| Security threats | `GET /admin/security/threats` | Observer (new) | `data.threats[]` |
| Security classifier | `GET /admin/security/classifier-stats` | Observer (new) | `data` |
| Observability | `GET /admin/observability/metrics` | Observer (new) | `data` |
| Incidents | `GET /admin/incidents` | Observer (STATIC) | `data.incidents[]` |
| Audit log | `GET /admin/audit-log` | Observer (new) | `data[]` (empty + note: table TBD) |
| Config | `GET /admin/config` | Observer (new) | `data` (sanitized) |
| Intel / abuse | `GET /admin/intel/abuse-overview` | LIVE (existing) | `summary`, `top_abusers` |
| Live feed | `GET /admin/live/feed` (SSE) | LIVE (existing) | event stream |

## Deployment status (IMPORTANT)
The 18 observer endpoints are committed on `satelink/admin-observer-wiring-2026-06` but are
**NOT yet live** — the backend deploys only on merge to GitHub `main`. They were verified by
loading the router against prod Postgres read-only and invoking each handler (all 200 ok:true).
After merge → Railway auto-deploys → confirm with:
```bash
TOKEN=$(railway variables --service Satelink-api --kv | sed -n 's/^ADMIN_SECRET_TOKEN=//p')
for p in executive/summary revenue/summary revenue/events revenue/funnel demand/leads \
  demand/stats network/health nodes/list billing/credits treasury/status customers/list \
  agents/status security/threats security/classifier-stats observability/metrics \
  incidents audit-log config; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Admin-Token: $TOKEN" \
    https://api.satelink.network/admin/$p)  /admin/$p"
done
```

## Known runtime notes
- `treasury/status` `dry_run` / `signer_balance_pol` reflect the **deployed** env at runtime
  (prod: `SETTLEMENT_DRY_RUN=1`, `signerBalance=null`).
- `incidents` is STATIC until an incidents table exists; `audit-log` returns `[]` + note until
  `admin_audit_log` is migrated.
- `agents/status` reports the Railway service state (FAILED); it does not call the down service.
