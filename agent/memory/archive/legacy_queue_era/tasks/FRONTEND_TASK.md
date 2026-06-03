# FRONTEND_WORKER TASK — Admin Panel + Conversion Flow (SAT-56 Slot 4)
# Assigned by: CEO
# Issue: SAT-13 (admin panel) + conversion flow
# Model: claude-sonnet-4-6
# Max Turns: 20
# Status: ACTIVE

## YOUR JOB

Two specific tasks. Complete both, commit, and write DONE to PROGRESS.md.

---

## Task A: Wire admin panel real data (SAT-13)

File: apps/web/src/app/admin/page.tsx and subdirectories

Replace all hardcoded numbers with real API calls:
- Epoch number → GET /api/status (field: current_epoch)
- Node count → GET /api/status (field: nodes_online)
- Revenue → GET /api/financial or /api/settlement/audit (real USDT amount)

Verify: epoch shows 5732+, node count shows 0, revenue shows real USDT value.

---

## Task B: Add free-tier upgrade prompt (conversion flow)

When a visitor hits the site from a blocked IP, show upgrade prompt.

1. Find the 402 handler in apps/web/ — search for 402 or PaymentRequired
2. If no 402 handler exists in frontend, create one at:
   apps/web/src/app/gateway/rpc/[chain]/route.ts
3. The prompt should show:
   "You've used your 500 free calls today.
    Deposit 1 USDT to rpc.satelink.network to continue."
   With deposit address and instructions.

---

## COMMIT AND EXIT

Commit both fixes:
  git add apps/web/src/
  git commit -m "feat(SAT-13): admin panel live data + free-tier upgrade prompt"
  git push origin main

Write to /Users/pradeepjakuraa/satelink/agent/memory/PROGRESS.md:
  DONE | slot=SAT56-4 | task=frontend_admin_conversion | commit=HASH | timestamp=[now]

End with: "ISSUE STATUS: DONE — admin panel + conversion flow committed"
STOP. Max 20 turns.
