# DEVOPS_WORKER TASK — SLOT C3-1
# Assigned by: CEO (SAT-63 queue advance)
# Created: 2026-05-30
# Queue slot: C3-1 (Cycle 3, first slot)
# Mapped to: BACKEND_WORKER (DEVOPS_WORKER not yet in Paperclip; use BACKEND_WORKER)

---

## OBJECTIVE
Railway autoscaling + observability setup

---

## TASKS

### Task 1: Railway Autoscaling
- Log in to Railway dashboard (or use Railway CLI)
- Configure autoscaling rules for the API service:
  - Min instances: 1
  - Max instances: 3
  - Scale-up trigger: CPU > 70% for 60s
  - Scale-down: CPU < 30% for 120s
- Document the configuration

### Task 2: Log Observability
- Set up log ingestion for the Satelink API service
- Options (pick fastest to configure):
  - Option A: Railway's built-in log drains → export to Logtail/BetterStack
  - Option B: OpenObserve self-hosted (if already available)
  - Option C: Grafana Cloud free tier
- Confirm logs are ingesting from /health and API request paths

### Task 3: Document in DEVOPS_RUNBOOK.md
- Create `docs/DEVOPS_RUNBOOK.md`
- Contents:
  - Autoscaling config (what was set + how to change it)
  - Log ingestion config (provider, endpoint, token location)
  - Rollback procedure (how to redeploy previous version)
  - Common incident responses (service down, DB unreachable, high CPU)

---

## EXIT CRITERIA
- [ ] Autoscaling configured (or documented why not possible with current Railway plan)
- [ ] Log ingestion active (at least one log line visible in observability tool)
- [ ] docs/DEVOPS_RUNBOOK.md committed
- [ ] Write DONE entry to agent/memory/PROGRESS.md:
      `DONE | slot=C3-1 | task=devops_setup | result=<summary> | commit=<hash> | timestamp=<ISO>`

---

## CONTEXT
- Satelink API runs on Railway
- Backend: Node.js 20 + Express, port 8080
- Current health: /health returns ok, db=ok
- Epoch 5732 as of last check
- 0 nodes online — first operators expected soon (high-load event likely when they join)
- No autoscaling configured yet — risk of degradation on first operator spike
