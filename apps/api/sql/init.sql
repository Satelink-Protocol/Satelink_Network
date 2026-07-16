-- =============================================================
-- Satelink Postgres Bootstrap
-- Runs once on first container init via docker-entrypoint-initdb.d
-- Database "satelink" is auto-created by POSTGRES_DB env var
-- =============================================================

-- ── Core tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS registered_nodes (
    wallet TEXT PRIMARY KEY,
    node_type TEXT DEFAULT 'edge',
    active INTEGER DEFAULT 1,
    is_flagged INTEGER DEFAULT 0,
    last_heartbeat BIGINT,
    last_nonce INTEGER DEFAULT 0,
    infra_reserved REAL DEFAULT 0,
    "updatedAt" BIGINT,
    latency INTEGER DEFAULT 0,
    bandwidth REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS op_weights (
    op_type TEXT PRIMARY KEY,
    weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS op_counts (
    epoch_id INTEGER NOT NULL,
    user_wallet TEXT NOT NULL,
    op_type TEXT NOT NULL,
    ops REAL DEFAULT 0,
    weight REAL DEFAULT 1.0,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (epoch_id, user_wallet, op_type)
);

CREATE TABLE IF NOT EXISTS rate_limits (
    node_wallet TEXT NOT NULL,
    op_type TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (node_wallet, op_type)
);

CREATE TABLE IF NOT EXISTS heartbeat_security_log (
    id SERIAL PRIMARY KEY,
    node_wallet TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_failures (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    ip TEXT,
    created_at BIGINT NOT NULL
);

-- ── Revenue tables ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments_inbox (
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS revenue_events (
    id SERIAL PRIMARY KEY,
    amount REAL NOT NULL DEFAULT 0,
    amount_usdt REAL DEFAULT 0,
    token TEXT DEFAULT 'USDT',
    source TEXT DEFAULT 'UNKNOWN',
    source_type TEXT,
    provider TEXT,
    payer_wallet TEXT,
    reference TEXT,
    tx_ref TEXT,
    epoch_id INTEGER,
    on_chain_tx TEXT,
    enterprise_id TEXT,
    created_at BIGINT NOT NULL
);

-- ── Epoch Revenue Pipeline V2 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS epochs (
    id SERIAL PRIMARY KEY,
    starts_at BIGINT NOT NULL,
    ends_at BIGINT,
    status TEXT DEFAULT 'OPEN',
    total_revenue_usdt REAL DEFAULT 0,
    node_pool_usdt REAL DEFAULT 0,
    platform_share_usdt REAL DEFAULT 0,
    distributor_share_usdt REAL DEFAULT 0,
    total_node_weight REAL DEFAULT 0,
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS revenue_events_v2 (
    id SERIAL PRIMARY KEY,
    epoch_id INTEGER,
    op_type TEXT NOT NULL,
    node_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    request_id TEXT,
    created_at BIGINT NOT NULL,
    metadata_hash TEXT,
    price_version INTEGER DEFAULT 1,
    surge_multiplier REAL DEFAULT 1.0,
    unit_cost REAL DEFAULT 0,
    unit_count INTEGER DEFAULT 1,
    UNIQUE(client_id, op_type, request_id)
);

CREATE TABLE IF NOT EXISTS epoch_earnings (
    epoch_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    wallet_or_node_id TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNPAID',
    created_at BIGINT NOT NULL,
    PRIMARY KEY (epoch_id, role, wallet_or_node_id)
);

CREATE TABLE IF NOT EXISTS balances (
    wallet TEXT PRIMARY KEY,
    amount_usdt REAL DEFAULT 0,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS node_epoch_earnings (
    id SERIAL PRIMARY KEY,
    node_id TEXT NOT NULL,
    epoch_id INTEGER NOT NULL,
    earnings_usdt REAL NOT NULL,
    ops_processed INTEGER DEFAULT 0,
    weight REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pricing_rules (
    op_type TEXT PRIMARY KEY,
    base_price_usdt REAL NOT NULL,
    version INTEGER DEFAULT 1,
    surge_enabled INTEGER DEFAULT 0,
    surge_threshold INTEGER DEFAULT 100,
    surge_multiplier REAL DEFAULT 1.5
);

CREATE TABLE IF NOT EXISTS node_uptime (
    node_wallet TEXT NOT NULL,
    epoch_id INTEGER NOT NULL,
    uptime_seconds INTEGER DEFAULT 0,
    score REAL DEFAULT 0,
    PRIMARY KEY (node_wallet, epoch_id)
);

-- ── Execution metrics ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS execution_metrics (
    id SERIAL PRIMARY KEY,
    source_id TEXT,
    source_type TEXT,
    chain TEXT,
    requests_handled INTEGER DEFAULT 0,
    latency_avg REAL DEFAULT 0,
    updated_at BIGINT
);

-- ── Enterprise ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enterprise_clients (
    client_id TEXT PRIMARY KEY,
    company_name TEXT,
    wallet_address TEXT,
    plan_type TEXT DEFAULT 'BASIC',
    rate_per_op REAL DEFAULT 0.002,
    monthly_minimum REAL DEFAULT 1000,
    deposit_balance REAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS enterprise_api_keys (
    api_key TEXT PRIMARY KEY,
    client_id TEXT REFERENCES enterprise_clients(client_id),
    created_at BIGINT
);

-- ── Genesis nodes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS genesis_nodes (
    node_id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    region TEXT,
    capabilities TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS external_providers (
    provider_name TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    supported_chains TEXT,
    latency_score REAL DEFAULT 0,
    cost_per_request REAL DEFAULT 0,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS node_capabilities (
    id SERIAL PRIMARY KEY,
    node_id TEXT,
    capability TEXT,
    chain TEXT,
    endpoint TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS settlement_evm_txs (
    id SERIAL PRIMARY KEY,
    batch_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    chain_name TEXT,
    asset_symbol TEXT,
    to_address TEXT,
    amount_atomic TEXT,
    nonce INTEGER,
    tx_hash TEXT,
    status TEXT, -- 'sent', 'confirmed', 'failed'
    error_message TEXT,
    created_at BIGINT,
    updated_at BIGINT,
    UNIQUE(batch_id, item_id)
);

-- ── Job queue ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_queue_log (
    job_id TEXT PRIMARY KEY,
    client_id TEXT,
    job_type TEXT,
    payload TEXT,
    priority TEXT,
    reward REAL,
    status TEXT,
    route TEXT DEFAULT 'INTERNAL',
    created_at BIGINT,
    completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS workload_pricing (
    workload_type TEXT PRIMARY KEY,
    base_cost_usdt REAL NOT NULL,
    base_reward_usdt REAL NOT NULL,
    created_at BIGINT
);

-- ── Workload discovery ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workload_registry (
    workload_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    market_source TEXT NOT NULL,
    reward_estimate REAL NOT NULL,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

-- ── Ops marketplace ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_registry (
    op_id TEXT PRIMARY KEY,
    op_type TEXT NOT NULL,
    target TEXT,
    payload TEXT NOT NULL,
    reward REAL NOT NULL,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS universal_ops_metrics (
    id SERIAL PRIMARY KEY,
    operations_received INTEGER DEFAULT 0,
    operations_executed INTEGER DEFAULT 0,
    revenue_generated REAL DEFAULT 0,
    updated_at BIGINT
);

-- ── Marketplace ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    reward REAL NOT NULL,
    payload TEXT NOT NULL,
    creator_wallet TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_metrics (
    id SERIAL PRIMARY KEY,
    jobs_submitted INTEGER DEFAULT 0,
    jobs_executed INTEGER DEFAULT 0,
    revenue_generated REAL DEFAULT 0,
    updated_at BIGINT
);

-- ── Futures ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_futures_contracts (
    contract_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    epoch_start INTEGER NOT NULL,
    epoch_end INTEGER NOT NULL,
    revenue_share REAL NOT NULL,
    price REAL NOT NULL,
    buyer_wallet TEXT,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS futures_metrics (
    id SERIAL PRIMARY KEY,
    contracts_listed INTEGER DEFAULT 0,
    contracts_sold INTEGER DEFAULT 0,
    future_revenue_locked REAL DEFAULT 0,
    investors_paid_out REAL DEFAULT 0,
    updated_at BIGINT
);

-- ── Backpressure ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_capacity (
    node_id TEXT PRIMARY KEY,
    max_jobs INTEGER DEFAULT 10,
    active_jobs INTEGER DEFAULT 0,
    reputation_score REAL DEFAULT 0,
    latency_score REAL DEFAULT 0
);

-- ── Auth ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pair_codes (
    code TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    device_id TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_pair_codes_wallet ON pair_codes(wallet);
CREATE INDEX IF NOT EXISTS idx_pair_codes_status ON pair_codes(status);

CREATE TABLE IF NOT EXISTS nodes (
    node_id TEXT PRIMARY KEY,
    wallet TEXT,
    device_type TEXT DEFAULT 'undefined',
    management_type TEXT DEFAULT 'community',
    status TEXT DEFAULT 'pending',
    last_seen BIGINT,
    created_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_nodes_wallet ON nodes(wallet);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    actor_wallet TEXT,
    action_type TEXT NOT NULL,
    target_id TEXT,
    metadata TEXT,
    created_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_wallet);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    primary_wallet TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'active',
    created_at BIGINT,
    last_login_at BIGINT
);

CREATE TABLE IF NOT EXISTS auth_nonces (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    used_at BIGINT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_address ON auth_nonces(address);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expiry ON auth_nonces(expires_at);

-- ── Observability ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_client_attribution (
    api_key TEXT PRIMARY KEY,
    partner_id TEXT,
    integration TEXT,
    source TEXT,
    sdk TEXT,
    machine_id TEXT,
    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    payment_status TEXT
);

CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    builder_wallet TEXT,
    endpoint TEXT,
    method TEXT,
    status_code INTEGER,
    latency_ms INTEGER,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS error_events (
    id SERIAL PRIMARY KEY,
    service TEXT,
    route TEXT,
    method TEXT,
    status_code INTEGER,
    message TEXT,
    stack_hash TEXT,
    stack_preview TEXT,
    trace_id TEXT,
    request_id TEXT,
    client_id TEXT,
    count INTEGER DEFAULT 1,
    first_seen_at BIGINT,
    last_seen_at BIGINT
);

CREATE TABLE IF NOT EXISTS conversions (
    id SERIAL PRIMARY KEY,
    ref_code TEXT,
    wallet TEXT,
    role TEXT,
    node_id TEXT,
    created_at BIGINT
);

-- ── Slow queries (admin control room) ────────────────────────────
CREATE TABLE IF NOT EXISTS slow_queries (
    id SERIAL PRIMARY KEY,
    query_hash TEXT,
    avg_ms REAL,
    p95_ms REAL,
    count INTEGER DEFAULT 1,
    last_seen_at BIGINT,
    sample_sql TEXT,
    source TEXT,
    trace_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slow_queries_hash ON slow_queries(query_hash);

-- ── Security alerts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_alerts (
    id SERIAL PRIMARY KEY,
    severity TEXT,
    category TEXT,
    entity_type TEXT,
    entity_id TEXT,
    title TEXT,
    evidence_json TEXT,
    status TEXT DEFAULT 'open',
    assigned_to TEXT,
    created_at BIGINT,
    resolved_by TEXT,
    resolved_at BIGINT,
    resolution_notes TEXT
);

-- ── User settings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
    wallet TEXT PRIMARY KEY,
    ui_mode TEXT DEFAULT 'SIMPLE',
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0
);

-- ── Public identity ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_identity (
    wallet TEXT PRIMARY KEY,
    public_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(public_id)
);

CREATE INDEX IF NOT EXISTS idx_public_identity_id ON public_identity(public_id);

-- ── Automation jobs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    schedule TEXT NOT NULL,
    interval_ms INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    last_fire BIGINT
);

-- ── Referrals ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_wallet TEXT,
    referee_wallet TEXT,
    metadata TEXT,
    status TEXT DEFAULT 'pending',
    created_at BIGINT
);

-- ── Growth and Economics ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_profitability_daily (
    date_key TEXT NOT NULL,
    node_id TEXT NOT NULL,
    revenue_generated REAL DEFAULT 0,
    rewards_earned REAL DEFAULT 0,
    op_count INTEGER DEFAULT 0,
    infra_cost_est REAL DEFAULT 0,
    uptime_pct REAL DEFAULT 0,
    success_rate REAL DEFAULT 0,
    avg_latency_ms REAL DEFAULT 0,
    rank INTEGER,
    net_profit REAL DEFAULT 0,
    PRIMARY KEY (date_key, node_id)
);

CREATE TABLE IF NOT EXISTS unit_economics_daily (
    date_key TEXT PRIMARY KEY,
    total_revenue REAL DEFAULT 0,
    total_rewards REAL DEFAULT 0,
    total_nodes_active INTEGER DEFAULT 0,
    burn_rate REAL DEFAULT 0,
    avg_margin_percent REAL DEFAULT 0,
    created_at BIGINT
);

-- ── Settlement & Payouts ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    tx_hash TEXT UNIQUE,
    retry_count INTEGER DEFAULT 0,
    error_log TEXT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_wallet ON withdrawals(wallet);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

CREATE TABLE IF NOT EXISTS payout_batches_v2 (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    currency TEXT DEFAULT 'USDT',
    total_amount REAL DEFAULT 0,
    fee_amount REAL DEFAULT 0,
    adapter_type TEXT,
    external_ref TEXT,
    tx_hash TEXT,
    meta_json TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS payout_items_v2 (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES payout_batches_v2(id),
    wallet TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payout_items_batch ON payout_items_v2(batch_id);

CREATE TABLE IF NOT EXISTS settlement_shadow_log (
    id SERIAL PRIMARY KEY,
    batch_id TEXT,
    primary_json TEXT,
    shadow_json TEXT,
    created_at BIGINT NOT NULL
);

-- ── System Flags & Support ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_flags (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_by TEXT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS onboarding_state (
    wallet TEXT PRIMARY KEY,
    step_completed_json TEXT,
    completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    wallet TEXT NOT NULL,
    message TEXT,
    bundle_json TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at BIGINT NOT NULL
);

-- ── 009_gateway_and_security ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS gateway_metrics (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feature_flags_v2 (
    flag_key TEXT PRIMARY KEY,
    is_enabled INTEGER DEFAULT 0,
    rules_json TEXT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS diagnostics_results (
    id SERIAL PRIMARY KEY,
    check_name TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS enforcement_events (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason_codes_json TEXT,
    ttl_seconds INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS abuse_counters_5m (
    window_start BIGINT NOT NULL,
    key_type TEXT NOT NULL,
    key_value TEXT NOT NULL,
    metric TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (window_start, key_type, key_value, metric)
);

CREATE TABLE IF NOT EXISTS abuse_events (
    node_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    created_at BIGINT NOT NULL
);

-- ── 010_ops_and_billing ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_billing (
    operator_id TEXT PRIMARY KEY,
    nodeops_monthly_cost_usdt REAL NOT NULL DEFAULT 0,
    prepaid_until BIGINT, 
    reserve_start_date BIGINT, 
    reserve_months_total INTEGER DEFAULT 6,
    reserve_rate REAL DEFAULT 0.10,
    reserve_balance_usdt REAL DEFAULT 0,
    reserve_target_usdt REAL,
    arrears_usdt REAL DEFAULT 0,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    period_start BIGINT,
    period_end BIGINT,
    type TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    direction TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    reference_id TEXT,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS daily_ops_reports (
    id SERIAL PRIMARY KEY,
    start_ts BIGINT,
    end_ts BIGINT,
    error_count INTEGER,
    slow_query_count INTEGER,
    incident_count INTEGER,
    beta_user_count INTEGER,
    active_invites INTEGER,
    top_errors TEXT, -- JSON
    top_slow_queries TEXT, -- JSON
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS node_registry (
    node_id     TEXT PRIMARY KEY,
    node_type   TEXT NOT NULL DEFAULT 'community',
    region      TEXT NOT NULL DEFAULT 'global',
    capacity    REAL NOT NULL DEFAULT 10,
    reputation  REAL NOT NULL DEFAULT 100,
    status      TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_log (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    size_bytes INTEGER,
    checksum TEXT,
    duration_ms INTEGER,
    status TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS workload_metrics (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS execution_assurance_metrics (
     id SERIAL PRIMARY KEY,
     execution_source TEXT NOT NULL,
     success_count INTEGER DEFAULT 0,
     fallback_events INTEGER DEFAULT 0,
     updated_at BIGINT
);

-- ── 011_economics_and_claims ───────────────────────────────────
CREATE TABLE IF NOT EXISTS epoch_anchors (
    epoch_id INTEGER PRIMARY KEY,
    merkle_root TEXT NOT NULL,
    total_revenue TEXT NOT NULL,
    tx_hash TEXT,
    anchored_at BIGINT,
    status TEXT DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS epoch_claims (
    id SERIAL PRIMARY KEY,
    epoch_id INTEGER NOT NULL,
    operator_wallet TEXT NOT NULL,
    amount_usdt TEXT NOT NULL,
    leaf_hash TEXT NOT NULL,
    proof TEXT,
    UNIQUE(epoch_id, operator_wallet)
);

CREATE TABLE IF NOT EXISTS node_growth_stats (
    node_id TEXT PRIMARY KEY,
    jobs_completed INTEGER DEFAULT 0,
    earnings_today REAL DEFAULT 0,
    earnings_total REAL DEFAULT 0,
    last_active BIGINT,
    updated_at BIGINT
);

-- ── 012_monitoring_and_incidents ────────────────────────────────
CREATE TABLE IF NOT EXISTS stress_test_runs (
    id SERIAL PRIMARY KEY,
    type TEXT,
    params_json TEXT,
    duration_ms INTEGER,
    ops_count INTEGER,
    avg_latency_ms REAL,
    p95_latency_ms REAL,
    errors INTEGER,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS treasury_snapshots (
    id SERIAL PRIMARY KEY,
    total_balance TEXT NOT NULL,
    pending_claims_total TEXT NOT NULL,
    liquidity_ratio REAL NOT NULL,
    withdraw_status TEXT NOT NULL,
    snapshot_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_withdrawals (
    id SERIAL PRIMARY KEY,
    operator_wallet TEXT NOT NULL,
    amount_usdt TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    withdrawn_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_metrics (
    id SERIAL PRIMARY KEY,
    heap_used_mb REAL,
    rss_mb REAL,
    event_loop_lag_ms REAL,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS demand_metrics (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS incident_bundles (
    id TEXT PRIMARY KEY,
    kind TEXT,
    title TEXT,
    severity TEXT,
    status TEXT,
    source_kind TEXT,
    context_json TEXT,
    summary TEXT,
    created_at BIGINT,
    updated_at BIGINT,
    resolved_at BIGINT,
    resolved_by TEXT,
    request_notes TEXT,
    preferred_scope TEXT,
    max_risk REAL,
    task_spec_json TEXT
);

    id SERIAL PRIMARY KEY,
    kind TEXT,
    status TEXT,
    duration_ms INTEGER,
    output_json TEXT,
    error_message TEXT,
    created_at BIGINT
);

-- ── 013_reputation_and_regions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS node_reputation (
    node_id TEXT PRIMARY KEY,
    uptime_score REAL DEFAULT 50,
    latency_score REAL DEFAULT 50,
    reliability_score REAL DEFAULT 50,
    fraud_penalty_score REAL DEFAULT 0,
    revenue_score REAL DEFAULT 50,
    composite_score INTEGER DEFAULT 50,
    tier TEXT DEFAULT 'bronze',
    last_updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS reputation_history (
    id SERIAL PRIMARY KEY,
    node_id TEXT NOT NULL,
    composite_score INTEGER,
    tier TEXT,
    recorded_at BIGINT
);

CREATE TABLE IF NOT EXISTS region_activation (
    region_code TEXT PRIMARY KEY,
    region_name TEXT,
    status TEXT DEFAULT 'inactive',
    node_cap INTEGER DEFAULT 50,
    active_nodes_count INTEGER DEFAULT 0,
    revenue_cap_usdt_daily REAL DEFAULT 100,
    rewards_cap_usdt_daily REAL DEFAULT 50,
    created_at BIGINT,
    updated_at BIGINT
);

-- ── 014_growth_and_commissions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS distributor_commissions (
    id TEXT PRIMARY KEY,
    distributor_wallet TEXT NOT NULL,
    source_event_id TEXT,
    amount_usdt REAL,
    status TEXT DEFAULT 'accrued',
    fraud_flag INTEGER DEFAULT 0,
    fraud_score INTEGER DEFAULT 0,
    commission_rate REAL,
    daily_cap REAL,
    tier_level INTEGER,
    referral_depth INTEGER,
    decay_days INTEGER,
    parent_referrer TEXT,
    created_at BIGINT
);

-- ── 015_sla_and_tenants ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_plans (
    id TEXT PRIMARY KEY,
    name TEXT,
    target_success_rate REAL,
    target_p95_latency_ms INTEGER,
    monthly_fee_usdt REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenant_limits (
    partner_id TEXT PRIMARY KEY,
    plan_id TEXT REFERENCES sla_plans(id),
    max_rps INTEGER,
    max_daily_ops INTEGER,
    max_daily_spend_usdt REAL,
    allowed_op_types_json TEXT,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS tenant_circuit_state (
    partner_id TEXT PRIMARY KEY,
    state TEXT DEFAULT 'closed',
    last_reset_day TEXT,
    ops_today INTEGER DEFAULT 0,
    spend_today_usdt REAL DEFAULT 0,
    disabled_ops_json TEXT DEFAULT '[]',
    tripped_at BIGINT,
    recovers_at BIGINT,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS tenant_sla_daily (
    day_yyyymmdd TEXT,
    partner_id TEXT,
    total_ops INTEGER,
    failed_ops INTEGER,
    success_rate REAL,
    p95_latency_ms REAL,
    budget_remaining_pct REAL,
    created_at BIGINT,
    PRIMARY KEY (day_yyyymmdd, partner_id)
);

CREATE TABLE IF NOT EXISTS tenant_op_slo_daily (
    day_yyyymmdd TEXT,
    partner_id TEXT,
    op_type TEXT,
    p95_latency_ms REAL,
    success_rate REAL,
    total_ops INTEGER,
    created_at BIGINT,
    PRIMARY KEY (day_yyyymmdd, partner_id, op_type)
);

CREATE TABLE IF NOT EXISTS sla_reports (
    id TEXT PRIMARY KEY,
    partner_id TEXT,
    month_yyyymm TEXT,
    report_json TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS sla_credits (
    id TEXT PRIMARY KEY,
    partner_id TEXT,
    amount_usdt REAL,
    reason TEXT,
    status TEXT,
    created_at BIGINT
);

-- ── 016_tracing_and_partners ────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_traces (
    trace_id TEXT PRIMARY KEY,
    request_id TEXT,
    route TEXT,
    method TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    client_id TEXT,
    node_id TEXT,
    ip_hash TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ops_traces (
    node_id TEXT NOT NULL,
    op_type TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_pricing (
    op_type TEXT PRIMARY KEY,
    price_usdt REAL NOT NULL,
    enabled INTEGER DEFAULT 1,
    max_per_minute_per_client INTEGER DEFAULT 60,
    max_per_minute_per_node INTEGER DEFAULT 120
);

CREATE TABLE IF NOT EXISTS partner_registry (
    partner_id TEXT PRIMARY KEY,
    partner_name TEXT,
    wallet TEXT,
    api_key_hash TEXT,
    status TEXT DEFAULT 'pending',
    rate_limit_per_min INTEGER DEFAULT 60,
    revenue_share_percent REAL DEFAULT 10,
    total_revenue REAL DEFAULT 0,
    total_ops INTEGER DEFAULT 0,
    created_at BIGINT,
    updated_at BIGINT
);

-- ── 017_stability_and_authenticity ──────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_stability_daily (
    day_yyyymmdd INTEGER PRIMARY KEY,
    revenue_usdt REAL,
    revenue_volatility_7d REAL,
    client_concentration REAL,
    region_concentration REAL,
    surge_dependency REAL,
    node_distribution_fairness REAL,
    stability_score REAL,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS usage_authenticity_daily (
    day_yyyymmdd INTEGER PRIMARY KEY,
    total_ops INTEGER,
    ops_unique_clients INTEGER,
    ops_unique_wallets INTEGER,
    ops_from_test_keys INTEGER,
    ops_replay_suspected INTEGER,
    duplicate_request_id_rate REAL,
    op_entropy_score REAL,
    authenticity_score REAL,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS daily_state_snapshots (
    day_yyyymmdd INTEGER PRIMARY KEY,
    totals_json TEXT,
    hash_proof TEXT,
    created_at BIGINT,
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS ledger_integrity_runs (
    day_yyyymmdd INTEGER PRIMARY KEY,
    ok INTEGER,
    findings_json TEXT,
    created_at BIGINT
);

-- ── 018_economic_ledger ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS economic_accounts (
    account_key TEXT PRIMARY KEY,
    account_type TEXT,
    label TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS economic_ledger_entries (
    id SERIAL PRIMARY KEY,
    txn_id TEXT NOT NULL,
    line_no INTEGER NOT NULL,
    account_key TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    memo TEXT,
    event_type TEXT,
    reference_type TEXT,
    reference_id TEXT,
    created_by TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS economic_ledger_chain (
    id SERIAL PRIMARY KEY,
    ledger_entry_id INTEGER REFERENCES economic_ledger_entries(id),
    txn_id TEXT NOT NULL,
    hash_prev TEXT NOT NULL,
    hash_current TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS economic_account_balances (
    account_key TEXT PRIMARY KEY,
    balance_usdt REAL DEFAULT 0,
    updated_at BIGINT
);

-- ── 019_node_heartbeats ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS node_heartbeats (
    node_id TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    status TEXT,
    payload_json TEXT
);

-- ── Bootstrap data ──────────────────────────────────────────────
INSERT INTO system_config (key, value) VALUES ('security_freeze', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('withdrawals_paused', '0') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('dynamic_profit_guard_enabled', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('default_profit_margin', '25') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('launch_mode_profit_margin', '40') ON CONFLICT (key) DO NOTHING;
INSERT INTO universal_ops_metrics (id, updated_at) VALUES (1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) ON CONFLICT (id) DO NOTHING;
INSERT INTO marketplace_metrics (id, updated_at) VALUES (1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) ON CONFLICT (id) DO NOTHING;
INSERT INTO futures_metrics (id, updated_at) VALUES (1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) ON CONFLICT (id) DO NOTHING;

-- Initial System Flags
INSERT INTO system_flags (key, value, updated_at) VALUES ('safe_mode_enabled', '0', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) ON CONFLICT (key) DO NOTHING;
INSERT INTO system_flags (key, value, updated_at) VALUES ('settlement_adapter', 'SIMULATED', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) ON CONFLICT (key) DO NOTHING;
INSERT INTO system_flags (key, value, updated_at) VALUES ('settlement_dry_run', '0', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) ON CONFLICT (key) DO NOTHING;
