#!/usr/bin/env bash
# M2 gate — read-only verification that ONE real x402 payment traversed the whole pipe.
# Usage: scripts/ops/m2-gate.sh 0x<txhash> [baseline_reconciled_count]
# Baseline captured 2026-09-15 01:33 UTC: reconciled_count=1, drift=0, halted=false.
set -euo pipefail
TX="${1:?tx hash required}"; BASE="${2:-1}"
[[ "$TX" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "bad tx hash"; exit 2; }
cd "$(dirname "$0")/../.."
q() { railway run --service Postgres-iQeW npx tsx scripts/ops/sat-db.ts "$1" 2>/dev/null; }
echo "== payment_sources (expect 1 row, is_test_data=false, payer != founder)"
q "SELECT payer, amount_usd, network, is_test_data, credited_api_key IS NOT NULL credited, created_at FROM payment_sources WHERE tx_hash = '$TX'"
echo "== revenue_events_v2 (expect 1 row)"
q "SELECT id, amount_usdt, status, demand_source, is_test_data, created_at FROM revenue_events_v2 WHERE request_id = 'x402:$TX'"
echo "== ledger_txns (expect 1 row)"
q "SELECT txn_id, kind, ref_type, ref_id, currency, state, posted_at FROM ledger_txns WHERE ref_id LIKE '%$TX%'"
echo "== ledger_entries balance (expect debit total = credit total)"
q "SELECT direction, SUM(amount)::text total, count(*) n FROM ledger_entries WHERE txn_id IN (SELECT txn_id FROM ledger_txns WHERE ref_id LIKE '%$TX%') GROUP BY direction"
echo "== reconciler (expect drift=0, halted=false, reconciled_count > $BASE, last_run_at after payment)"
q "SELECT r.drift_minor_units::text drift, r.halted, r.halt_reason, r.reconciled_count, r.reconciled_count > $BASE AS read_new_row,
          r.last_run_at, r.last_run_at > (SELECT max(posted_at) FROM ledger_txns WHERE ref_id LIKE '%$TX%') AS ran_after_payment
   FROM reconciliation_state r WHERE id = 1"
