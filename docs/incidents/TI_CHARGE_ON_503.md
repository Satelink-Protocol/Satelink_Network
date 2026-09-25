# Incident — Trading Intelligence charged before it had data

_2026-09-25 · fix: `fix/ti-charge-after-success`_

## What happened
`GET /v1/intelligence/:metric` deducted $0.01 (`authorizeAndMeter`) **before** reading the snapshot.
When the snapshot was missing (`warming_up`) or the read failed, it returned 503 and **kept the charge**.

## Impact (read-only, production, 2026-09-25)
- `intelligence_snapshots` is empty — TI has **never** served data in production, and there are 0 TI
  revenue rows.
- Charged-503 reconstruction (per key per day: spend − RPC revenue, on days with no served TI call):
  **0 calls · $0.00 · 0 keys.** Cross-check: every key's lifetime `total_spent` minus its recorded
  revenue leaves only multiples of $0.00003 (the RPC price), never $0.01.
- Limitation: `api_usage_daily` holds 3 rows (older days are not retained), so days before its oldest row
  cannot be reconstructed. `total_spent` (lifetime, never pruned) shows no $0.01-granularity gap.

## Fix
Read first, charge second: free account check (401/403, no charge) → read snapshot with a 5 s timeout →
503 `charged:false` on missing / failed / timed-out / unserialisable snapshot → only then the unchanged
atomic `authorizeAndMeter` deduction → data returned only if the deduction succeeded.

## Refund script (founder runs after review)
`apps/api/scripts/incidents/refund_ti_503_charges.mjs` — dry-run default; `--apply` claims each
(key, day) in `ti_503_refunds` and credits it in the same transaction (idempotent; verified locally:
second run refunds $0). Today's dry run: nothing to refund.
