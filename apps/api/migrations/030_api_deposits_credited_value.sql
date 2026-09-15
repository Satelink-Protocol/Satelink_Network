-- 030_api_deposits_credited_value.sql
-- T-17b: x402 bundle settlements were writing two different dollar amounts
-- into api_deposits.amount_usdt depending on caller:
--   - every other deposit path (api_keys_route.mjs, credit_service.creditAccount,
--     deposit_listener.js): amount_usdt == the amount actually settled/received.
--   - x402/settlement.js (bundle path): amount_usdt == bundleCalls * PRICE_PER_CALL,
--     the VALUE CREDITED, not what was paid (a $0.10 1,000-call bundle wrote
--     0.03, not 0.10 — the platform margin silently disappeared from the row).
--
-- Fix: amount_usdt stays "amount settled" everywhere (consistent meaning across
-- every deposit path). credited_usdt is the new column for "value actually
-- added to the spendable balance" — equal to amount_usdt for every existing
-- 1:1 deposit path, and can differ only for bundle-priced settlements.

ALTER TABLE api_deposits ADD COLUMN IF NOT EXISTS credited_usdt NUMERIC(18,6);

-- Backfill: every deposit written before this migration credited 1:1
-- (bundle pricing is the only path that will ever diverge, and it starts
-- writing credited_usdt going forward from the settlement.js change).
UPDATE api_deposits SET credited_usdt = amount_usdt WHERE credited_usdt IS NULL;

ALTER TABLE api_deposits ALTER COLUMN credited_usdt SET NOT NULL;
