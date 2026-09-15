-- 031_dodo_payment_source.sql
-- M5 (T-17): Dodo is a new payment_sources.source value — the human payment
-- rail (cards, UPI via Dodo Payments), parallel to 'x402' (agents) and
-- 'polygon_usdt_vault' (on-chain deposits).
--
-- payment_sources.tx_hash is reused as the generic external-payment
-- idempotency key (it always was "external payment reference", never
-- strictly a blockchain hash — x402 already puts a real tx hash there, but
-- nothing requires one). Dodo rows use:
--   'dodo:<payment_id>'                                   for payment.succeeded
--   'dodo:sub:<subscription_id>:<previous_billing_date>'  for subscription.renewed
--     (Dodo's Subscription webhook payload carries no payment_id — see
--     src/routes/internal_dodo.js for why this synthetic key is safe.)

ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_source_check;
ALTER TABLE payment_sources ADD CONSTRAINT payment_sources_source_check
  CHECK (source IN ('polygon_usdt_vault', 'x402', 'dodo', 'marketplace', 'other'));
