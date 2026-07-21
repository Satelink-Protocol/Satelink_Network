-- M6 vNext Production Reliability schema (additive; no legacy tables touched).
-- Append-only journal, exactly-once idempotency, durable supplier registry,
-- and a dead-letter queue. All tables are prefixed `vnext_` and independent of
-- the legacy 32-table schema.

-- Append-only, hash-linked event journal (the durable Transaction Journal /
-- Event Store). `seq` is a global monotonic order; the hash chain is verified
-- in application code exactly as the in-memory Journal does.
CREATE TABLE IF NOT EXISTS vnext_journal (
  seq          BIGSERIAL PRIMARY KEY,
  stream_id    TEXT   NOT NULL,          -- txId, supplier:<id>, fee:<txId>, ...
  phase        TEXT   NOT NULL,          -- DISCOVER/QUOTE/ROUTE/EXECUTE/FEE/SETTLE/CLOSED/...
  payload      JSONB  NOT NULL,
  ts           BIGINT NOT NULL,
  hash_prev    TEXT   NOT NULL,
  hash_current TEXT   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vnext_journal_stream ON vnext_journal(stream_id, seq);

-- Exactly-once idempotency results, keyed by `${txId}:${phase}`. Survives
-- process restart: a re-run of a completed phase returns the stored result and
-- never re-executes the side effect.
CREATE TABLE IF NOT EXISTS vnext_idempotency (
  key      TEXT PRIMARY KEY,
  result   JSONB NOT NULL,
  created  BIGINT NOT NULL
);

-- Durable supplier registry snapshot (latest state per supplier).
CREATE TABLE IF NOT EXISTS vnext_suppliers (
  supplier_id TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  updated_at  BIGINT NOT NULL
);

-- Dead-letter queue: transactions that could not complete within retry limits.
CREATE TABLE IF NOT EXISTS vnext_dlq (
  tx_id     TEXT PRIMARY KEY,
  reason    TEXT   NOT NULL,
  attempts  INT    NOT NULL,
  request   JSONB  NOT NULL,
  failed_at BIGINT NOT NULL
);

-- Durable outbound-payment ledger. Every authorized outbound payment is
-- recorded exactly once (idem_key PK), so per-hour/per-day rolling caps survive
-- restart and a retried payment never double-spends. amount is integer minor
-- units stored as TEXT (summed as BigInt in app code — no float).
CREATE TABLE IF NOT EXISTS vnext_outbound (
  idem_key TEXT PRIMARY KEY,
  amount   TEXT   NOT NULL,
  ref      TEXT,
  ts       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vnext_outbound_ts ON vnext_outbound(ts);

-- Treasury revenue ledger. THE record of real collected revenue: one row per
-- fulfilled resale, exactly-once by tx_id. amount_in = collected from the
-- caller, cost = paid to the supplier, spread = amount_in - cost (net revenue).
-- amounts are integer minor units as TEXT (summed as BigInt — no float). tx_in_ref
-- is the on-chain/settlement reference for the inbound payment (external audit).
CREATE TABLE IF NOT EXISTS vnext_treasury (
  tx_id     TEXT PRIMARY KEY,
  amount_in TEXT   NOT NULL,
  cost      TEXT   NOT NULL,
  spread    TEXT   NOT NULL,
  unit      TEXT   NOT NULL,
  tx_in_ref TEXT,
  payer     TEXT,
  ts        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vnext_treasury_ts ON vnext_treasury(ts);

-- Withdrawal ledger: admin-initiated treasury payouts to the FIXED cold address.
-- Exactly-once by idem_key. Separate table so payouts never affect the outbound
-- supplier-payment rolling caps.
CREATE TABLE IF NOT EXISTS vnext_withdrawal (
  idem_key TEXT PRIMARY KEY,
  amount   TEXT   NOT NULL,
  dest     TEXT   NOT NULL,
  ref      TEXT,
  status   TEXT   NOT NULL,
  ts       BIGINT NOT NULL
);
