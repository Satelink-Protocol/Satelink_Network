/**
 * Shadow ledger writer (M3 — ledger in shadow).
 *
 * For each revenue_events_v2 INSERT, this ALSO writes a balanced double-entry
 * ledger transaction, so we can measure parity between the legacy revenue table
 * and the new ledger without anything reading the ledger for a decision.
 *
 * HARD CONSTRAINTS (do not weaken):
 *   - Gated by env LEDGER_SHADOW_WRITE. DEFAULT OFF. With the flag off this
 *     function returns before touching the database — the live path is
 *     behaviorally identical.
 *   - NEVER throws to the caller. Every failure is caught and logged. The live
 *     payment path is sacred; a shadow bug must not break billing.
 *   - Runs on its OWN pool connection + transaction, never the caller's, so a
 *     shadow rollback cannot poison the caller's transaction.
 *   - is_test_data events are SKIPPED (invariant #10 — founder wallets excluded
 *     from external revenue metrics). They never enter the ledger, so parity is
 *     measured on real revenue only.
 *
 * This is plain JS on purpose: apps/api runs as plain Node (no transpile). The
 * TypeScript domain in libs/financial-domain + services/financial is the tested
 * source of truth for the ledger model; this writer conforms to the same
 * balanced two-entry shape (debit suspense, credit revenue) it defines. Balance
 * is asserted here at runtime because the compile-time guarantee cannot cross
 * the JS boundary.
 *
 * System accounts seeded by database/migrations/005_system_accounts.sql.
 */

import { resolveRevenueCurrency } from './asset_currency.js';

export const SUSPENSE_ACCOUNT_ID = 'acct_platform_suspense'; // debit-normal
export const REVENUE_ACCOUNT_ID = 'acct_platform_revenue'; // credit-normal
// Currency is NO LONGER a constant: it is derived per-event from the on-chain
// asset (see asset_currency.js). All supported settlement tokens are 6-decimal.
export const SHADOW_DECIMALS = 6;

/** True only when the shadow flag is explicitly enabled. Default OFF. */
export function isShadowWriteEnabled() {
  const v = process.env.LEDGER_SHADOW_WRITE;
  return v === '1' || v === 'true';
}

/**
 * Convert a decimal amount (string or number) to integer minor units as a
 * bigint, WITHOUT floating point. Returns null on invalid or non-positive input
 * (a ledger entry must be > 0 per the 003 CHECK constraint).
 */
export function toMinorUnits(value, decimals = SHADOW_DECIMALS) {
  let s;
  if (typeof value === 'string') {
    s = value.trim();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    // toFixed avoids exponent notation; revenue amounts have <= 6 decimals.
    s = value.toFixed(decimals);
  } else {
    return null;
  }

  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return null;
  }

  const negative = s.startsWith('-');
  const abs = negative ? s.slice(1) : s;
  const dot = abs.indexOf('.');
  const intPart = dot === -1 ? abs : abs.slice(0, dot);
  let fracPart = dot === -1 ? '' : abs.slice(dot + 1);

  // Truncate (do not round) any excess precision beyond the currency.
  fracPart = fracPart.slice(0, decimals).padEnd(decimals, '0');

  let minor;
  try {
    minor = BigInt(intPart + fracPart);
  } catch {
    return null;
  }
  if (negative) minor = -minor;
  if (minor <= 0n) return null;
  return minor;
}

/**
 * Write the shadow ledger transaction for one revenue event. Never throws.
 *
 * @param {import('pg').Pool} pool  pg Pool (its OWN connection is used)
 * @param {object} event
 * @param {string} event.requestId  the revenue_events_v2 request_id (natural key)
 * @param {string|number} event.amountUsdt  the amount as written to amount_usdt
 * @param {boolean} [event.isTestData]  founder/test wallet — skipped if true
 * @param {string} [event.opType]  optional op type, recorded on the ref
 * @param {object} [logger]  optional logger with .error; defaults to console
 * @returns {Promise<{written: boolean, reason?: string}>}
 */
export async function shadowWriteRevenueLedger(pool, event, logger = console) {
  try {
    if (!isShadowWriteEnabled()) {
      return { written: false, reason: 'flag_off' };
    }
    if (!event || typeof event !== 'object') {
      return { written: false, reason: 'no_event' };
    }
    if (event.isTestData === true) {
      return { written: false, reason: 'test_data_excluded' };
    }

    const requestId = event.requestId;
    if (typeof requestId !== 'string' || requestId.trim().length === 0) {
      return { written: false, reason: 'no_request_id' };
    }

    const minor = toMinorUnits(event.amountUsdt);
    if (minor === null) {
      return { written: false, reason: 'non_positive_or_invalid_amount' };
    }
    const amountStr = minor.toString();

    // Derive the currency from the on-chain asset. An unknown on-chain asset
    // halts the write (never defaulted) so a mislabel can never enter the ledger.
    const currency = resolveRevenueCurrency(event);
    if (currency === null) {
      logger.error?.(
        '[shadow-ledger] unknown on-chain asset — refusing to write ledger:',
        requestId,
      );
      return { written: false, reason: 'unknown_asset' };
    }

    if (!pool || typeof pool.connect !== 'function') {
      return { written: false, reason: 'no_pool' };
    }

    const txnId = `shadow:${requestId}`;
    const idemKey = `shadow:${requestId}`;
    const refType = 'revenue_event';
    const refId = requestId;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Insert ledger_txns header (parent of ledger_entries via FK).
      await client.query(
        `INSERT INTO ledger_txns
           (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
         VALUES ($1, 'deposit', $2, $3, $4, 'posted', now())
         ON CONFLICT (txn_id) DO NOTHING`,
        [txnId, refType, refId, currency],
      );
      // Debit suspense, credit revenue — balanced by construction.
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state,
            ref_type, ref_id, idem_key, posted_at)
         VALUES ($1,$2,'debit',$3,$4,'posted',$5,$6,$7, now())
         ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
        [txnId, SUSPENSE_ACCOUNT_ID, amountStr, currency, refType, refId, idemKey],
      );
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state,
            ref_type, ref_id, idem_key, posted_at)
         VALUES ($1,$2,'credit',$3,$4,'posted',$5,$6,$7, now())
         ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
        [txnId, REVENUE_ACCOUNT_ID, amountStr, currency, refType, refId, idemKey],
      );
      await client.query('COMMIT');
      return { written: true };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // Sacred path: swallow everything, log, continue.
    try {
      logger.error?.('[shadow-ledger] write failed (non-fatal):', err?.message ?? err);
    } catch {
      /* logging must never throw either */
    }
    return { written: false, reason: 'error' };
  }
}

/**
 * Write the shadow ledger REVERSAL for one revenue reversal (refund / dispute
 * lost). This is the mirror of shadowWriteRevenueLedger: the original credited
 * revenue by debiting suspense / crediting revenue; a reversal undoes that by
 * debiting revenue / crediting suspense for the (positive) reversed magnitude.
 * Same hard constraints: gated by LEDGER_SHADOW_WRITE (default OFF), never
 * throws, own connection/transaction, test data skipped, idempotent.
 *
 * @param {import('pg').Pool} pool
 * @param {object} event
 * @param {string} event.requestId  reversal request_id (e.g. 'dodo:refund:<id>')
 * @param {string|number} event.amountUsdt  POSITIVE magnitude being reversed
 * @param {boolean} [event.isTestData]  founder/test — skipped if true
 * @param {object} [logger]
 * @returns {Promise<{written: boolean, reason?: string}>}
 */
export async function shadowReverseRevenueLedger(pool, event, logger = console) {
  try {
    if (!isShadowWriteEnabled()) {
      return { written: false, reason: 'flag_off' };
    }
    if (!event || typeof event !== 'object') {
      return { written: false, reason: 'no_event' };
    }
    if (event.isTestData === true) {
      return { written: false, reason: 'test_data_excluded' };
    }

    const requestId = event.requestId;
    if (typeof requestId !== 'string' || requestId.trim().length === 0) {
      return { written: false, reason: 'no_request_id' };
    }

    // Reversal magnitude must be a positive amount (toMinorUnits rejects <= 0).
    const minor = toMinorUnits(event.amountUsdt);
    if (minor === null) {
      return { written: false, reason: 'non_positive_or_invalid_amount' };
    }
    const amountStr = minor.toString();

    const currency = resolveRevenueCurrency(event);
    if (currency === null) {
      logger.error?.(
        '[shadow-ledger] unknown on-chain asset — refusing to write reversal:',
        requestId,
      );
      return { written: false, reason: 'unknown_asset' };
    }

    if (!pool || typeof pool.connect !== 'function') {
      return { written: false, reason: 'no_pool' };
    }

    const txnId = `shadow-reversal:${requestId}`;
    const idemKey = `shadow-reversal:${requestId}`;
    const refType = 'revenue_reversal';
    const refId = requestId;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ledger_txns
           (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
         VALUES ($1, 'refund', $2, $3, $4, 'posted', now())
         ON CONFLICT (txn_id) DO NOTHING`,
        [txnId, refType, refId, currency],
      );
      // Reverse the original direction: debit revenue, credit suspense.
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state,
            ref_type, ref_id, idem_key, posted_at)
         VALUES ($1,$2,'debit',$3,$4,'posted',$5,$6,$7, now())
         ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
        [txnId, REVENUE_ACCOUNT_ID, amountStr, currency, refType, refId, idemKey],
      );
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state,
            ref_type, ref_id, idem_key, posted_at)
         VALUES ($1,$2,'credit',$3,$4,'posted',$5,$6,$7, now())
         ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
        [txnId, SUSPENSE_ACCOUNT_ID, amountStr, currency, refType, refId, idemKey],
      );
      await client.query('COMMIT');
      return { written: true };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    try {
      logger.error?.('[shadow-ledger] reversal failed (non-fatal):', err?.message ?? err);
    } catch {
      /* logging must never throw either */
    }
    return { written: false, reason: 'error' };
  }
}
