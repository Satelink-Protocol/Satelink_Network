# Satelink Operations Runbook
Last verified: 2026-06-26.

## Deployment
- **Code ships on merge to GitHub `main`** → Railway (`Satelink-api`) and Vercel (`web`) auto-deploy.
- **`railway redeploy` / `railway up` do NOT ship local/uncommitted code** — they restart the
  *same image*. Use only to restart a service, never to "test" a local change.
- Stage files **individually** (`git add <file>`), never `git add -A`.
- Never push to `add-satelink-polygon-rpc` (protected Chainlist branch).

## Reading production safely
- DB (read-only): `psql "$DATABASE_URL"` — public URL is `Postgres-iQeW` `DATABASE_PUBLIC_URL`
  (`roundhouse.proxy.rlwy.net:21238/railway`).
- **Never** run the full API locally against prod DB — it starts the epoch scheduler +
  settlement anchor, which WRITE to prod. To verify endpoints, load just the router and invoke
  handlers read-only (see `satelink/admin-observer-wiring-2026-06` probe method).
- Health: `curl https://api.satelink.network/health` → `{ ok, server:ok, db:ok }`.

## Admin token
`railway variables --service Satelink-api --kv | sed -n 's/^ADMIN_SECRET_TOKEN=//p'`
Use the value **as-is** for `X-Admin-Token`. The Railway *table* view truncates both ends —
never hand-copy from the table.

## Check signer balance (before any settlement decision)
- `GET /admin/settlement/status` → `signerBalance`, `signerAddress`, `dryRun`, `threshold`.
- Signer `0x988fb0efC0f14111511dE3481E6c066018A0cf91`; currently `signerBalance=null`.
- **Never set `SETTLEMENT_DRY_RUN=0`** without (a) signer funded, (b) real revenue > $0.50,
  (c) explicit human decision.

## Read real revenue
```sql
SELECT COUNT(*) FILTER (WHERE NOT is_test_data) real_events,
       COALESCE(SUM(amount_usdt) FILTER (WHERE NOT is_test_data),0) real_usdt
FROM revenue_events_v2;          -- currently 1 / $0.00003
```

## Restart Paperclip agents
`Satelink_Paperclip` Railway service is **FAILED** (agents.satelink.network offline). Restart
from the Railway dashboard (service → Redeploy/Restart). The 12 Paperclip agents use the
`claude_local` adapter and need `ANTHROPIC_API_KEY` set in the container to run autonomously.

## Incident response checklist
1. `curl /health` — is the API up? (`db:ok`?)
2. Check Railway service status (`Satelink-api`, `Postgres-iQeW`, `Satelink_Paperclip`).
3. `GET /admin/observability/metrics` — cpu/mem/uptime/db/redis.
4. `GET /admin/settlement/status` — confirm `dryRun:true` (settlement not broadcasting).
5. Inspect `automation_logs` / `gas_alerts` for recent alerts.

## Rollback
- Code: revert the offending commit on `main` and push (Railway/Vercel redeploy the prior tree).
- Never `railway up` to roll back — it does not change the deployed code.
- DB: never drop/truncate. Use targeted, reviewed UPDATEs only.

## Verification commands (run after every deploy)
```bash
curl https://api.satelink.network/health
curl https://api.satelink.network/api/status
curl "https://api.satelink.network/credits/deposit/initiate?amount=1"
curl -o /dev/null -w "%{http_code}\n" https://app.satelink.network/satelink/os/deposit
```
