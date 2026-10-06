-- 010_node_claims.sql

CREATE TABLE IF NOT EXISTS node_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    epoch_id INTEGER NOT NULL,
    amount_usdt NUMERIC NOT NULL,
    tx_hash TEXT,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
