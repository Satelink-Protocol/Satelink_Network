/**
 * Reconciler — ledger ⟷ chain.
 *
 * For every ledger_txns row with ref_type='revenue_event' whose ref_id carries
 * an on-chain tx hash, verify against chain (DB + chain only, never app cache):
 *   - the transaction exists and is confirmed (≥ minConfirmations),
 *   - the token amount transferred to the expected recipient equals the ledger
 *     entry amount in integer minor units,
 *   - (recipient is enforced implicitly: the reader only counts transfers whose
 *     `to` is the expected vault/payTo, so a redirected payment reads as 0).
 *
 * drift = signed sum over rows of (ledger minor − confirmed-chain minor). Any
 * row whose tx is missing/unconfirmed contributes its full ledger amount (the
 * ledger claims money the chain has not settled). drift != 0 ⇒ halt + a
 * critical outbox event.
 *
 * Per-row subtraction uses kernel Money in the row's own currency, so a
 * cross-currency comparison is impossible (compile error / Result). The scalar
 * drift sum is in minor units and is only valid across equal-decimals tokens —
 * the reconciler asserts that per row (CURRENCY_DECIMALS_MISMATCH otherwise).
 */

import { Money } from '@satelink/kernel';
import type { Queryable } from '../db.js';
import type { ChainReader } from '../ports/chain-reader.js';
import { targetForRefId, currencyForCode } from '../chains.js';
import { emitEvent } from '../state.js';

export type RowStatus =
  | 'matched'
  | 'unconfirmed'
  | 'not_found'
  | 'failed'
  | 'amount_mismatch'
  | 'recipient_missing'
  | 'currency_error'
  | 'unreconcilable';

export interface RowReconciliation {
  readonly txnId: string;
  readonly refId: string;
  readonly status: RowStatus;
  readonly ledgerMinor: bigint;
  readonly chainMinor: bigint;
  readonly driftMinor: bigint;
}

export interface ReconcileResult {
  readonly driftMinorUnits: bigint;
  readonly halted: boolean;
  readonly haltReason: string | null;
  /** Rows that had an on-chain target and were checked against chain. */
  readonly reconciledCount: number;
  readonly rows: readonly RowReconciliation[];
}

interface RevenueRow {
  readonly txn_id: string;
  readonly ref_id: string;
  readonly currency: string;
  readonly ledger_minor: string;
}

const ANOMALY_ORDER: readonly RowStatus[] = [
  'currency_error',
  'not_found',
  'failed',
  'recipient_missing',
  'unconfirmed',
  'amount_mismatch',
];

function haltReasonFor(rows: readonly RowReconciliation[]): string {
  for (const status of ANOMALY_ORDER) {
    if (rows.some((r) => r.status === status)) {
      if (status === 'currency_error') return 'CURRENCY_DECIMALS_MISMATCH';
      return 'LEDGER_CHAIN_DRIFT';
    }
  }
  return 'LEDGER_CHAIN_DRIFT';
}

export async function reconcileOnce(
  exec: Queryable,
  chain: ChainReader,
  cfg: { minConfirmations: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReconcileResult> {
  const res = await exec.query<RevenueRow>(
    `SELECT lt.txn_id,
            lt.ref_id,
            lt.currency,
            COALESCE(
              SUM(le.amount) FILTER (WHERE le.direction = 'credit' AND le.state = 'posted'),
              0
            )::text AS ledger_minor
       FROM ledger_txns lt
       JOIN ledger_entries le ON le.txn_id = lt.txn_id
      WHERE lt.ref_type = 'revenue_event'
      GROUP BY lt.txn_id, lt.ref_id, lt.currency
      ORDER BY lt.txn_id`,
  );

  const rows: RowReconciliation[] = [];
  let driftMinor = 0n;
  let reconciledCount = 0;

  for (const row of res.rows) {
    const ledgerMinor = BigInt(row.ledger_minor);
    const target = targetForRefId(row.ref_id, env);
    if (target === null) {
      rows.push({
        txnId: row.txn_id,
        refId: row.ref_id,
        status: 'unreconcilable',
        ledgerMinor,
        chainMinor: 0n,
        driftMinor: 0n,
      });
      continue;
    }

    const currency = currencyForCode(row.currency);
    if (currency === null || currency.decimals !== target.tokenDecimals) {
      // Cannot compare minor units safely — the ledger amount is unverifiable.
      rows.push({
        txnId: row.txn_id,
        refId: row.ref_id,
        status: 'currency_error',
        ledgerMinor,
        chainMinor: 0n,
        driftMinor: ledgerMinor,
      });
      driftMinor += ledgerMinor;
      reconciledCount += 1;
      continue;
    }

    const obs = await chain.observeTransfer({
      chainKey: target.chain.chainKey,
      txHash: target.txHash,
      tokenContract: target.tokenContract,
      expectedRecipient: target.expectedRecipient,
    });
    reconciledCount += 1;

    const confirmed = obs.found && obs.success && obs.confirmations >= cfg.minConfirmations;
    const effectiveChainMinor = confirmed ? obs.amountToRecipientMinor : 0n;

    const ledgerMoney = Money.fromMinorUnits(ledgerMinor, currency);
    const chainMoney = Money.fromMinorUnits(effectiveChainMinor, currency);
    // Same currency by construction — subtract cannot be a currency mismatch.
    const mismatch = ledgerMoney.subtract(chainMoney);
    const rowDrift = mismatch.isOk ? mismatch.value.amount : ledgerMinor;

    let status: RowStatus;
    if (!obs.found) status = 'not_found';
    else if (!obs.success) status = 'failed';
    else if (obs.confirmations < cfg.minConfirmations) status = 'unconfirmed';
    else if (obs.amountToRecipientMinor === 0n) status = 'recipient_missing';
    else if (rowDrift !== 0n) status = 'amount_mismatch';
    else status = 'matched';

    driftMinor += rowDrift;
    rows.push({
      txnId: row.txn_id,
      refId: row.ref_id,
      status,
      ledgerMinor,
      chainMinor: obs.amountToRecipientMinor,
      driftMinor: rowDrift,
    });
  }

  const halted = driftMinor !== 0n;
  const haltReason = halted ? haltReasonFor(rows) : null;

  if (halted) {
    const anomalies = rows.filter((r) => r.status !== 'matched' && r.status !== 'unreconcilable');
    await emitEvent(exec, {
      // Idempotent per drift magnitude — a steady drift does not spam events.
      eventId: `reconciliation.drift.${driftMinor.toString()}`,
      eventType: 'reconciliation.drift_detected',
      severity: 'critical',
      payload: {
        driftMinorUnits: driftMinor.toString(),
        haltReason,
        anomalies: anomalies.map((r) => ({
          txnId: r.txnId,
          refId: r.refId,
          status: r.status,
          ledgerMinor: r.ledgerMinor.toString(),
          chainMinor: r.chainMinor.toString(),
          driftMinor: r.driftMinor.toString(),
        })),
      },
    });
  }

  return { driftMinorUnits: driftMinor, halted, haltReason, reconciledCount, rows };
}
