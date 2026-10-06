-- 012_settlement_batches.sql
-- Settlement batch tracking for on-chain anchoring
-- Created: April 18, 2026

CREATE TABLE IF NOT EXISTS settlement_batches (
    id SERIAL PRIMARY KEY,
    batch_id TEXT UNIQUE NOT NULL,
    epoch_id INTEGER,
    chain_id INTEGER,
    adapter_type TEXT,
    total_amount_usdt NUMERIC,
    item_count INTEGER,
    status TEXT DEFAULT 'pending',
    tx_hash TEXT,
    submitted_at BIGINT,
    confirmed_at BIGINT,
    error_message TEXT,
    created_at BIGINT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_settlement_batches_epoch ON settlement_batches(epoch_id);
CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches(status);
CREATE INDEX IF NOT EXISTS idx_settlement_batches_chain ON settlement_batches(chain_id);
