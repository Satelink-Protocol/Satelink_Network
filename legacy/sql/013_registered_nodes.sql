-- S2-001: Node Registration Table
-- Migration: 013_registered_nodes.sql

CREATE TABLE IF NOT EXISTS registered_nodes (
  id SERIAL PRIMARY KEY,
  node_id TEXT UNIQUE NOT NULL,
  wallet TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'rpc',
  endpoint_url TEXT NOT NULL,
  region TEXT NOT NULL,
  chain_ids JSONB NOT NULL DEFAULT '[]',
  hardware_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  tier TEXT NOT NULL DEFAULT 'bronze',
  reputation_score INTEGER DEFAULT 0,
  uptime_pct NUMERIC(5,2) DEFAULT 0,
  registered_at BIGINT NOT NULL,
  last_heartbeat_at BIGINT,
  updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_registered_nodes_wallet ON registered_nodes(wallet);
CREATE INDEX IF NOT EXISTS idx_registered_nodes_region ON registered_nodes(region);
CREATE INDEX IF NOT EXISTS idx_registered_nodes_status ON registered_nodes(status);
CREATE INDEX IF NOT EXISTS idx_registered_nodes_node_type ON registered_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_registered_nodes_tier ON registered_nodes(tier);

COMMENT ON TABLE registered_nodes IS 'DePIN node registry for RPC, bandwidth, and compute nodes';
COMMENT ON COLUMN registered_nodes.node_id IS 'Unique node identifier: NODE-{region}-{8hex}';
COMMENT ON COLUMN registered_nodes.tier IS 'Node tier: bronze (0-500), silver (501-2000), gold (2001-5000), platinum (5001+)';
COMMENT ON COLUMN registered_nodes.status IS 'pending, active, inactive, suspended';
