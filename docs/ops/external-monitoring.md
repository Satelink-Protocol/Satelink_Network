# External monitoring — the layer the guardrails structurally cannot provide

The reconciler guardrails (row-growth, volume, write-amp, driver-liveness) run **inside
the reconciler, which depends on Postgres**. When the DB dies, the guardrails die with it —
they cannot alarm on their own failure domain. The 2026-08-28 outage proved this: the
Railway Compute Usage Limit ($11) was hit, every service stopped project-wide, and the only
guardrail evidence was a `[reconciler] guardrails failed (fail-open)` line — discovered by
accident, not paged. These two checks are the **outer layer**, deliberately outside Railway
and the DB.

## 3.1 External uptime check on /health (operator — you must create the account)
`api.satelink.network/health` returns **200** when the app is up and Railway's edge returns
**404 "Application not found"** when no deployment is serving (the outage signature). An
external HTTP check catches both — from outside the failure domain.

**SHIPPED: GitHub Actions workflow** (`.github/workflows/health-check.yml`). Runs on GitHub's
infra (outside Railway/Postgres) every 5 min: probes `/health`, requires HTTP 200 **and**
`"db":"ok"` (so a DB-down while the process is up still alarms), opens a de-duped GitHub issue
labelled `health-incident` on failure, closes it on recovery, and fails the run so GitHub emails
the workflow author. Manual test: **Actions → health-check → Run workflow**. Activates once merged
to the default branch. Caveats: GitHub cron is best-effort (can lag 5–15 min) and scheduled
workflows auto-disable after 60 days of repo inactivity — so UptimeRobot below is still the
preferred upgrade for a tighter, independent interval.

**UptimeRobot (free tier, 5-min interval) — optional upgrade:**
1. Create a free account at https://uptimerobot.com (the agent cannot create it for you).
2. **Add New Monitor** → Monitor Type: **HTTP(s)**.
3. Friendly Name: `Satelink API /health`.
4. URL: `https://api.satelink.network/health`.
5. Monitoring Interval: **5 minutes** (free-tier minimum).
6. Advanced → **Keyword** (optional but recommended): keyword type **exists**, keyword `ok`
   — so a 200 with a broken body still alarms. (The health body is `{"status":"ok"}`.)
7. Alert Contacts: add your email; **notify on Down and on Up**.
8. Save. Confirm the first check shows **Up (200)**.

This pages within ~5 min of a DB-down / edge-404 / deploy-failure — none of which the
in-DB guardrails can report.

## 3.2 Railway usage-limit alert — never hit the kill switch silently again
The Compute Usage Limit is a **kill switch, not a budget**: hitting it stops every service
project-wide (it caused the 2026-08-28 outage at $11.08 against an $11 limit). It is now $25.
Alert at 80% ($20) so there is always runway to act before the switch trips.

**Railway dashboard:**
1. Open the project → **Settings → Usage** (or **Account → Usage** for the plan-level limit).
2. Under **Usage Limits**, confirm the hard limit is **$25** (keep it ≥ 2× expected spend;
   the standing rule is: cut usage, never lower the cap toward actual spend).
3. Set a **soft/alert threshold at $20 (80%)** — Railway calls this the "email me at" or
   "notification threshold". Enter your email.
4. Save. Verify the alert email address is correct.

If Railway's plan does not expose a soft alert, replicate it externally: the usage is on the
metrics API; a weekly manual check of **Settings → Usage** against the $20 line is the manual
fallback — note it explicitly rather than assuming the alert exists.

## Why both, and why external
| failure | in-DB guardrails | external uptime | usage alert |
|---|---|---|---|
| row-storm / volume fill (slow burn) | ✅ (hourly) | — | — |
| DB down / edge 404 / deploy fail | ❌ (same failure domain) | ✅ | — |
| compute-limit kill switch approaching | ❌ | ❌ (fires only after it trips) | ✅ (at 80%, before) |
