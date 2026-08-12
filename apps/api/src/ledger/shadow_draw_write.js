/**
 * Shadow draw writer (M6 — Draw + Settlement in shadow).
 *
 * This records ALREADY-CONFIRMED x402 settlements, so draws are inserted as
 * 'settled' and settlements as 'confirmed' with 0 required confirmations. The
 * pending->posted state machine is deliberately NOT exercised here. Real
 * confirmation polling arrives in M7.
 *
 * This is plain JS by design. Apps/api runs as plain Node (no transpile), so
 * importing TS workspace packages at runtime causes production build failures.
 *
 * Gated by DRAW_SHADOW_WRITE. Default OFF.
 * NEVER throws.
 */

import { toMinorUnits, SUSPENSE_ACCOUNT_ID, REVENUE_ACCOUNT_ID, SHADOW_DECIMALS } from './shadow_ledger_write.js';

// Capacity accounts are USDT-denominated (M4 backfill). This writer is DISABLED
// (DRAW_SHADOW_WRITE=0) and per the M7 decision must NOT record x402 payments as
// draws; this constant only keeps its capacity-account lookup + dormant rows
// well-formed. It is NOT the revenue currency — that is derived per asset in
// asset_currency.js / shadow_ledger_write.js.
const SHADOW_DRAW_CURRENCY = 'USDT';

export function isDrawShadowWriteEnabled() {
  const v = process.env.DRAW_SHADOW_WRITE;
  return v === '1' || v === 'true';
}

export async function shadowWriteDraw(pool, event, logger = console) {
  try {
    if (!isDrawShadowWriteEnabled()) {
      return { written: false, reason: 'flag_off' };
    }
    if (!event || typeof event !== 'object') {
      return { written: false, reason: 'no_event' };
    }
    if (event.isTestData === true) {
      return { written: false, reason: 'test_data_excluded' };
    }

    const { txHash, payer, amountUsd, network } = event;
    if (typeof txHash !== 'string' || txHash.trim().length === 0) {
      return { written: false, reason: 'no_tx_hash' };
    }

    const minor = toMinorUnits(amountUsd, SHADOW_DECIMALS);
    if (minor === null) {
      return { written: false, reason: 'non_positive_or_invalid_amount' };
    }
    const amountStr = minor.toString();

    if (!pool || typeof pool.connect !== 'function') {
      return { written: false, reason: 'no_pool' };
    }

    const drawId = `draw_x402_${txHash}`;
    const txnId = `txn_x402_${txHash}`;
    const idempotencyKey = `idem_x402_draw_${txHash}`;
    const fundingSourceId = `fs_x402_${payer}`;
    const authorizationId = `auth_x402_${txHash}`;
    const nowMs = Date.now();
    // draws.created_at is timestamptz as of migration 009 (M6.5); pass a Date so
    // node-pg serializes it correctly. settlements.confirmed_at is still BIGINT
    // (epoch ms), so it keeps nowMs.
    const nowDate = new Date(nowMs);
    const refType = 'draw';
    const idemKeyTx = `shadow:${txnId}`;

    const client = await pool.connect();
    try {
      const pRes = await client.query('SELECT id FROM principals WHERE external_ref = LOWER($1)', [payer]);
      if (pRes.rowCount === 0) {
        return { written: false, reason: 'principal_not_found' };
      }
      const principalId = pRes.rows[0].id;

      const aRes = await client.query(
        "SELECT id FROM accounts WHERE principal_id = $1 AND kind = 'capacity' AND currency = $2",
        [principalId, SHADOW_DRAW_CURRENCY]
      );
      if (aRes.rowCount === 0) {
        return { written: false, reason: 'account_not_found' };
      }
      const accountId = aRes.rows[0].id;

      await client.query('BEGIN');

      // 1. Insert Draw
      await client.query(
        `INSERT INTO draws (
          id, principal_id, account_id, funding_source_id, authorization_id,
          amount, currency, idempotency_key, state, reject_reason, version, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'settled', NULL, 0, $9)
        ON CONFLICT (idempotency_key) DO NOTHING`,
        [drawId, principalId, accountId, fundingSourceId, authorizationId, amountStr, SHADOW_DRAW_CURRENCY, idempotencyKey, nowDate]
      );

      // 2. Insert Settlement
      await client.query(
        `INSERT INTO settlements (
          draw_id, state, rail_tx_hash, rail_network, confirmations, required_confirmations, attempt_count, confirmed_at
        ) VALUES ($1, 'confirmed', $2, $3, 0, 0, 0, $4)
        ON CONFLICT (draw_id) DO NOTHING`,
        [drawId, txHash, network || null, nowMs]
      );

      // 3. Insert ledger_txns header (parent of ledger_entries via the FK
      //    added in migration 009 / M6.5). Must exist before its entries.
      await client.query(
        `INSERT INTO ledger_txns
           (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
         VALUES ($1, 'draw', $2, $3, $4, 'posted', now())
         ON CONFLICT (txn_id) DO NOTHING`,
        [txnId, refType, drawId, SHADOW_DRAW_CURRENCY]
      );

      // 4. Insert Ledger Entries (Debit Suspense, Credit Revenue)
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state,
            ref_type, ref_id, idem_key, posted_at)
         VALUES ($1,$2,'debit',$3,$4,'posted',$5,$6,$7, now())
         ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
        [txnId, SUSPENSE_ACCOUNT_ID, amountStr, SHADOW_DRAW_CURRENCY, refType, drawId, idemKeyTx]
      );
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state,
            ref_type, ref_id, idem_key, posted_at)
         VALUES ($1,$2,'credit',$3,$4,'posted',$5,$6,$7, now())
         ON CONFLICT (idem_key, account_id, direction) DO NOTHING`,
        [txnId, REVENUE_ACCOUNT_ID, amountStr, SHADOW_DRAW_CURRENCY, refType, drawId, idemKeyTx]
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
      logger.error?.('[shadow-draw] write failed (non-fatal):', err?.message ?? err);
    } catch {
      /* logging must never throw either */
    }
    return { written: false, reason: 'error' };
  }
}
