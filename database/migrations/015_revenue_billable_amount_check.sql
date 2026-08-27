-- 015_revenue_billable_amount_check — DB-level backstop against phantom revenue.
--
-- Guarantee: a row marked is_billable=true MUST carry a positive collected charge.
-- No code path — including a future re-introduced legacy writer — can insert a
-- $0 (or NULL) "billable" revenue event again. Code guards (rpc_billing.js:41's
-- amountUsdt>0 check) can be bypassed by the next writer; this constraint cannot.
--
-- SCOPE / LIMIT (be honest): this catches the FREE-TIER $0 pattern. It does NOT
-- catch the Aug-2026 ws_subscription storm, whose rows were amount_usdt=0.000001
-- (> 0). That storm is prevented at the source by the WS auth gate in
-- ws_gateway.js (unauthenticated upgrades rejected) — a CHECK constraint cannot
-- rate-limit legitimate micro-charges from an unauthenticated firehose.
--
-- is_billable=false rows are unconstrained (free/internal/observability events may
-- legitimately be $0). Verified 2026-08-27: zero existing rows violate this, so
-- the ADD scans clean (min amount_usdt in the table is 0.000001).

ALTER TABLE revenue_events_v2
  ADD CONSTRAINT chk_billable_requires_positive_amount
  CHECK (is_billable = false OR (amount_usdt IS NOT NULL AND amount_usdt > 0));
