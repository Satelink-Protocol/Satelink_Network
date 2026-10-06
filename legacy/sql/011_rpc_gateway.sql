-- Stage S1: Core Revenue Engine — RPC Gateway Schema
-- Tables for RPC request logging, rate limiting, provider health, and response caching
-- PostgreSQL compatible (migrated from SQLite April 2026)

-- 1. RPC Request Log — every proxied JSON-RPC call
CREATE TABLE IF NOT EXISTS rpc_requests (
    id SERIAL PRIMARY KEY,
    request_id TEXT UNIQUE NOT NULL,
    client_id TEXT,                    -- enterprise_clients.client_id (NULL = public/free tier)
    api_key TEXT,                      -- hashed key used for the request
    method TEXT NOT NULL,              -- JSON-RPC method (eth_call, eth_getBalance, etc.)
    params_hash TEXT,                  -- SHA256 of params for dedup/caching
    provider_node_id TEXT,             -- node that served the request
    status TEXT DEFAULT 'pending',     -- pending | success | error | timeout
    response_time_ms INTEGER,         -- round-trip latency
    cost_usdt NUMERIC DEFAULT 0,      -- metered cost
    error_code INTEGER,               -- JSON-RPC error code if failed
    http_status INTEGER,              -- upstream HTTP status
    ip_hash TEXT,                     -- SHA256 of client IP
    region TEXT,                      -- inferred client region
    cached INTEGER DEFAULT 0,         -- 1 if served from cache
    created_at BIGINT NOT NULL        -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_rpc_requests_client ON rpc_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_rpc_requests_method ON rpc_requests(method);
CREATE INDEX IF NOT EXISTS idx_rpc_requests_created ON rpc_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_rpc_requests_provider ON rpc_requests(provider_node_id);
CREATE INDEX IF NOT EXISTS idx_rpc_requests_status ON rpc_requests(status);

-- 2. Rate Limit Windows — sliding window counters per key
CREATE TABLE IF NOT EXISTS rate_limit_windows (
    id SERIAL PRIMARY KEY,
    key_type TEXT NOT NULL,            -- 'api_key' | 'ip' | 'method'
    key_value TEXT NOT NULL,
    window_start BIGINT NOT NULL,      -- epoch seconds (floored to window boundary)
    window_size_sec INTEGER NOT NULL,  -- 1, 60, 3600 (second, minute, hour)
    request_count INTEGER DEFAULT 0,
    UNIQUE(key_type, key_value, window_start, window_size_sec)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limit_windows(key_type, key_value);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limit_windows(window_start);

-- 3. RPC Providers — upstream nodes that serve RPC requests
CREATE TABLE IF NOT EXISTS rpc_providers (
    id SERIAL PRIMARY KEY,
    node_id TEXT UNIQUE NOT NULL,       -- maps to registered_nodes.wallet or external provider
    endpoint_url TEXT NOT NULL,         -- JSON-RPC endpoint URL
    chain_id INTEGER NOT NULL,          -- EVM chain ID (80002 = Polygon Amoy, 137 = Polygon)
    provider_type TEXT DEFAULT 'node',  -- 'node' | 'fallback' | 'archive'
    region TEXT,                        -- geographic region for routing
    priority INTEGER DEFAULT 100,       -- lower = higher priority
    status TEXT DEFAULT 'active',       -- active | degraded | offline | maintenance
    max_rps INTEGER DEFAULT 50,         -- max requests/second this provider can handle
    avg_latency_ms INTEGER DEFAULT 0,   -- rolling average latency
    error_rate NUMERIC DEFAULT 0,       -- rolling error rate (0.0 - 1.0)
    consecutive_failures INTEGER DEFAULT 0,
    last_health_check BIGINT,           -- epoch ms
    last_success BIGINT,                -- epoch ms
    created_at BIGINT NOT NULL,
    updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_rpc_providers_chain ON rpc_providers(chain_id);
CREATE INDEX IF NOT EXISTS idx_rpc_providers_status ON rpc_providers(status);
CREATE INDEX IF NOT EXISTS idx_rpc_providers_region ON rpc_providers(region);

-- 4. RPC Method Pricing — per-method cost overrides
CREATE TABLE IF NOT EXISTS rpc_method_pricing (
    id SERIAL PRIMARY KEY,
    method TEXT UNIQUE NOT NULL,         -- eth_call, eth_sendRawTransaction, etc.
    category TEXT DEFAULT 'read',        -- 'read' | 'write' | 'archive' | 'trace'
    base_cost_usdt NUMERIC NOT NULL,     -- base cost per call
    weight NUMERIC DEFAULT 1.0,          -- multiplier for compute intensity
    cacheable INTEGER DEFAULT 0,         -- 1 if response can be cached
    cache_ttl_sec INTEGER DEFAULT 0,     -- cache lifetime in seconds
    rate_limit_per_sec INTEGER DEFAULT 0,-- per-method rate limit (0 = use global)
    enabled INTEGER DEFAULT 1
);

-- 5. Response Cache — short-lived cache for read-only RPC responses
CREATE TABLE IF NOT EXISTS rpc_response_cache (
    cache_key TEXT PRIMARY KEY,          -- method + params_hash + chain_id
    response_body TEXT NOT NULL,         -- JSON response
    chain_id INTEGER NOT NULL,
    method TEXT NOT NULL,
    expires_at BIGINT NOT NULL,          -- epoch ms
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rpc_cache_expires ON rpc_response_cache(expires_at);

-- 6. RPC Usage Aggregates — hourly rollups for analytics
CREATE TABLE IF NOT EXISTS rpc_usage_hourly (
    id SERIAL PRIMARY KEY,
    hour_start BIGINT NOT NULL,          -- epoch seconds floored to hour
    client_id TEXT,
    method TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    cached_count INTEGER DEFAULT 0,
    total_cost_usdt NUMERIC DEFAULT 0,
    avg_latency_ms NUMERIC DEFAULT 0,
    p99_latency_ms INTEGER DEFAULT 0,
    UNIQUE(hour_start, client_id, method, chain_id)
);

CREATE INDEX IF NOT EXISTS idx_rpc_usage_hour ON rpc_usage_hourly(hour_start);
CREATE INDEX IF NOT EXISTS idx_rpc_usage_client ON rpc_usage_hourly(client_id);

-- 7. Settlement Batches — on-chain settlement tracking
CREATE TABLE IF NOT EXISTS settlement_batches (
    id SERIAL PRIMARY KEY,
    batch_id TEXT UNIQUE NOT NULL,
    epoch_id INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    adapter_type TEXT NOT NULL,          -- 'polygon_evm' | 'shadow' | 'nodeops'
    total_amount_usdt NUMERIC NOT NULL,
    item_count INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',       -- pending | submitted | confirmed | failed
    tx_hash TEXT,                        -- on-chain transaction hash
    gas_used INTEGER,
    gas_price_gwei NUMERIC,
    submitted_at BIGINT,
    confirmed_at BIGINT,
    error_message TEXT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_epoch ON settlement_batches(epoch_id);
CREATE INDEX IF NOT EXISTS idx_settlement_status ON settlement_batches(status);

-- 8. Settlement Items — individual payouts within a batch
CREATE TABLE IF NOT EXISTS settlement_items (
    id SERIAL PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES settlement_batches(batch_id),
    recipient_wallet TEXT NOT NULL,
    amount_usdt NUMERIC NOT NULL,
    role TEXT NOT NULL,                  -- 'node_operator' | 'platform' | 'distributor'
    status TEXT DEFAULT 'pending',       -- pending | settled | failed
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_items_batch ON settlement_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_settlement_items_wallet ON settlement_items(recipient_wallet);

-- Seed default RPC method pricing (PostgreSQL syntax)
INSERT INTO rpc_method_pricing (method, category, base_cost_usdt, weight, cacheable, cache_ttl_sec) VALUES
    -- Read methods (cheap, cacheable)
    ('eth_blockNumber', 'read', 0.000001, 0.5, 1, 2),
    ('eth_chainId', 'read', 0.000001, 0.1, 1, 3600),
    ('net_version', 'read', 0.000001, 0.1, 1, 3600),
    ('eth_gasPrice', 'read', 0.000002, 0.5, 1, 5),
    ('eth_getBalance', 'read', 0.000005, 1.0, 1, 10),
    ('eth_getTransactionCount', 'read', 0.000005, 1.0, 1, 5),
    ('eth_getBlockByNumber', 'read', 0.000010, 2.0, 1, 30),
    ('eth_getBlockByHash', 'read', 0.000010, 2.0, 1, 300),
    ('eth_getTransactionByHash', 'read', 0.000008, 1.5, 1, 300),
    ('eth_getTransactionReceipt', 'read', 0.000010, 2.0, 1, 300),
    ('eth_getCode', 'read', 0.000008, 1.5, 1, 300),
    ('eth_getStorageAt', 'read', 0.000008, 1.5, 1, 10),
    ('eth_call', 'read', 0.000015, 3.0, 1, 5),
    ('eth_estimateGas', 'read', 0.000015, 3.0, 0, 0),
    ('eth_getLogs', 'read', 0.000050, 5.0, 1, 10),
    ('eth_feeHistory', 'read', 0.000010, 2.0, 1, 10),
    -- Write methods (expensive, never cached)
    ('eth_sendRawTransaction', 'write', 0.000100, 10.0, 0, 0),
    ('eth_sendTransaction', 'write', 0.000100, 10.0, 0, 0),
    -- Subscription / filter methods
    ('eth_newFilter', 'read', 0.000020, 3.0, 0, 0),
    ('eth_getFilterLogs', 'read', 0.000050, 5.0, 0, 0),
    ('eth_getFilterChanges', 'read', 0.000020, 3.0, 0, 0),
    ('eth_uninstallFilter', 'read', 0.000001, 0.1, 0, 0),
    -- Archive / trace methods (expensive)
    ('debug_traceTransaction', 'trace', 0.000500, 50.0, 1, 60),
    ('trace_block', 'trace', 0.001000, 100.0, 1, 300),
    ('trace_transaction', 'trace', 0.000500, 50.0, 1, 300)
ON CONFLICT (method) DO NOTHING;
