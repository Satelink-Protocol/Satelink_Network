# GROWTH_WORKER TASK — SLOT 5
Status: WAITING
Model: Claude Sonnet 4.6 (temporary)
Max Turns: 20

## JOB
Write the node operator onboarding guide.

## EXACT STEPS
1. Check if docs/NODE_OPERATOR_GUIDE.md exists
2. If exists — read it and improve/update. If not — create from scratch.
3. The guide must cover:
   - What is a Satelink node (1 paragraph)
   - Hardware requirements (router / VPS / home server)
   - How to register: POST /api/nodes/register with required fields
   - How heartbeat works (POST /api/nodes/heartbeat every 60s)
   - How earnings work (epoch-based, 50% to operators)
   - How to claim earnings (claim window, 48-day expiry)
   - How to check earnings: GET /api/nodes/:id/earnings
   - Support contact
4. Commit:
   git add docs/NODE_OPERATOR_GUIDE.md
   git commit -m "docs: node operator onboarding guide"
5. Write to agent/memory/PROGRESS.md:
   DONE | slot=5 | task=operator_guide | file=docs/NODE_OPERATOR_GUIDE.md | timestamp=$(date)
6. STOP.

## EXIT CONDITION
Guide committed. DONE written. STOP.
