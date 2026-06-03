# CURRENT SPRINT — ENTERPRISE OS PHASE 1

## Sprint Goal
First collected USDT. Not metered. Physically collected on-chain.

## Active Events (source of truth: ACTIVE_EVENTS.md)

EVT-REV-001 | REV-1 | ECONOMY_COMMANDER
→ Revenue truth validation: confirm collected vs metered gap

EVT-OPS-001 | OPS-2 | ENGINEERING_COMMANDER  
→ Local diagnostic failure: better-sqlite3 dependency issue

EVT-REV-002 | REV-2 | ECONOMY_COMMANDER
→ USDT payment flow verification end to end

EVT-CUST-001 | REV-2 | ECONOMY_COMMANDER
→ Customer Zero: first intentional paying machine customer

EVT-AUTO-001 | OPS-3 | AUTONOMY_COMMANDER
→ Automate founder daily revenue truth synthesis

## Blocking Questions (answer these before anything else)

1. Is BILLING_ENABLED=true in Railway production?
   Check: Railway dashboard → satelink service → Variables
   
2. Is there a working deposit flow?
   Test: Can a wallet deposit USDT and receive credits?
   
3. What does GET /system/free-tier return right now?
   Run: curl https://rpc.satelink.network/system/free-tier
   
4. Are the 62 near-limit IPs still there?
   Check: agent/memory/CONVERSIONS.md last update date

## Definition of Sprint Success

[ ] BILLING_ENABLED=true confirmed in production
[ ] One successful USDT deposit → credits → API call flow tested
[ ] PAYG pricing option exists (or decision made to add it)
[ ] Customer Zero: one machine or protocol identified as target
[ ] Collected USDT > $0 in REVENUE_LOG.md
