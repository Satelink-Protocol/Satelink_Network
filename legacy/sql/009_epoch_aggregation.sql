-- 009_epoch_aggregation.sql

CREATE TABLE IF NOT EXISTS node_epoch_earnings (
    node_id TEXT NOT NULL,
    epoch_id INTEGER NOT NULL,
    earnings_usdt NUMERIC NOT NULL,
    ops_processed INTEGER NOT NULL,
    weight NUMERIC NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (node_id, epoch_id)
);

ALTER TABLE epochs ADD COLUMN total_revenue_usdt NUMERIC DEFAULT 0;
ALTER TABLE epochs ADD COLUMN node_pool_usdt NUMERIC DEFAULT 0;
ALTER TABLE epochs ADD COLUMN platform_share_usdt NUMERIC DEFAULT 0;
ALTER TABLE epochs ADD COLUMN distributor_share_usdt NUMERIC DEFAULT 0;
ALTER TABLE epochs ADD COLUMN total_node_weight NUMERIC DEFAULT 0;
ALTER TABLE epochs ADD COLUMN closed_at TIMESTAMP;
