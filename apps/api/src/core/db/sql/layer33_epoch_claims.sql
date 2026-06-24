-- Phase 33: Epoch Claims
--
-- Backing table for the pull-model settlement claim generator
-- (apps/api/src/settlement/claim_generator.js). One row per
-- (epoch_id, operator_wallet) aggregated unpaid earning, holding the
-- Merkle leaf hash and on-chain claim status.

CREATE TABLE IF NOT EXISTS epoch_claims (
    epoch_id        integer NOT NULL,
    operator_wallet text NOT NULL,
    amount_usdt     text NOT NULL,
    leaf_hash       text NOT NULL,
    proof           jsonb DEFAULT NULL,
    status          text DEFAULT 'UNCLAIMED',
    claimed_tx_hash text,
    claimed_at      timestamptz,
    created_at      timestamptz DEFAULT now(),
    PRIMARY KEY (epoch_id, operator_wallet)
);

CREATE INDEX IF NOT EXISTS idx_epoch_claims_operator ON epoch_claims (operator_wallet);
CREATE INDEX IF NOT EXISTS idx_epoch_claims_status ON epoch_claims (status);
