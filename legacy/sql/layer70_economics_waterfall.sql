-- Phase 70: Economics Settlement Waterfall Tables

CREATE TABLE IF NOT EXISTS operator_billing (
    operator_id TEXT PRIMARY KEY,
    nodeops_monthly_cost_usdt DECIMAL(20, 8) NOT NULL DEFAULT 0,
    prepaid_until INTEGER, -- Unix timestamp
    reserve_start_date INTEGER, -- Unix timestamp
    reserve_months_total INTEGER DEFAULT 6,
    reserve_rate DECIMAL(5, 4) DEFAULT 0.10,
    reserve_balance_usdt DECIMAL(20, 8) DEFAULT 0,
    reserve_target_usdt DECIMAL(20, 8), -- nullable
    arrears_usdt DECIMAL(20, 8) DEFAULT 0,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY, -- uuid
    operator_id TEXT NOT NULL,
    period_start INTEGER,
    period_end INTEGER,
    type TEXT NOT NULL, -- REWARD_IN, NODEOPS_DUE, NODEOPS_PAYMENT, RESERVE_ALLOCATION, OPERATOR_PAYOUT, ADJUSTMENT
    amount_usdt DECIMAL(20, 8) NOT NULL,
    direction TEXT NOT NULL, -- 'in' or 'out' relative to operator payable balance
    status TEXT DEFAULT 'pending', -- pending, posted, failed
    reference_id TEXT,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_op ON ledger_entries(operator_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_status ON ledger_entries(status);
