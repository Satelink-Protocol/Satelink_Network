// apps/api/src/payments/x402/settlement.js
// Records a facilitator-settled x402 payment in ONE transaction:
//   payment_sources   (ledger of external payments, tx_hash UNIQUE)
//   revenue_events_v2 (demand_source='x402', same shape as rpc_billing.js)
//   api_credits       (bundle crediting — one settlement buys N calls)
//
// Replay protection is the facilitator's verify/settle PLUS the tx_hash
// UNIQUE constraints (payment_sources + api_deposits) — a duplicate
// settlement id rolls the whole transaction back (no double-credit) and the
// caller returns 409 without serving. No signature/crypto verification
// happens in this file by design.
//
// Bundle crediting mirrors credit_service.mjs exactly (same tables, same
// columns, same semantics — api_deposits row + credits_usdt/total_deposited
// update), it is NOT a parallel balance system. Consumption stays 100% in
// authorizeAndMeter. Wallet→account resolution matches resolveAccount
// (oldest api_credits row for the wallet) so credits land on the same row
// the serving path deducts from.

import { PRICE_PER_CALL_USDT } from '../../billing/credit_service.mjs';
import { isFounderWallet } from '../founder_wallets.js';
// M3 shadow ledger (DECISION 4: narrow exception to instrument the single
// revenue_events_v2 INSERT below — no other change to settlement logic).
import { shadowWriteRevenueLedger } from '../../ledger/shadow_ledger_write.js';
import { shadowWriteDraw } from '../../ledger/shadow_draw_write.js';

export class DuplicateSettlementError extends Error {
  constructor(txHash) {
    super(`x402 settlement already recorded: ${txHash}`);
    this.name = 'DuplicateSettlementError';
    this.txHash = txHash;
  }
}

// A settlement on a test network must never masquerade as real revenue
// (INC-013 class of problem). eip155:84532 = base-sepolia.
export function isTestNetwork(network) {
  return /84532|sepolia|testnet/i.test(String(network));
}

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export async function recordX402Settlement(pool, {
  txHash, payer, network, amountUsd,
  bundleCalls = 0, // when > 0, credit the payer's account with N calls
}) {
  // Founder-funded wallets never count as external revenue, regardless of
  // network; network-derived flagging still covers unknown testnet payers.
  const isTest = isTestNetwork(network) || isFounderWallet(payer);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bundle crediting — find-or-create the payer's account, then credit it
    // with bundleCalls worth of the SAME per-call unit authorizeAndMeter
    // deducts. Done first so payment_sources can reference the credited key.
    let creditedKey = null;
    let balanceAfter = null;
    if (bundleCalls > 0 && WALLET_RE.test(payer || '')) {
      const creditUsdt = bundleCalls * PRICE_PER_CALL_USDT;
      // Same resolution as credit_service.resolveAccount: oldest row wins.
      const existing = await client.query(
        `SELECT api_key FROM api_credits WHERE lower(wallet_address) = lower($1)
          ORDER BY created_at ASC LIMIT 1`,
        [payer]
      );
      creditedKey = existing.rows[0]?.api_key || `x402_${payer.toLowerCase()}`;
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO api_credits (api_key, tier, daily_limit, wallet_address, demand_source)
           VALUES ($1, 'x402', $2, $3, 'x402')
           ON CONFLICT (api_key) DO NOTHING`,
          [creditedKey, bundleCalls, payer.toLowerCase()]
        );
      }
      // Mirrors creditAccount: api_deposits row (tx_hash UNIQUE = second
      // idempotency layer) + credits/total_deposited bump. A 'free' account
      // is lifted to the paid x402 tier so the deduction path actually
      // charges it; existing paid tiers are preserved.
      await client.query(
        `INSERT INTO api_deposits (api_key, tx_hash, amount_usdt, from_address, tier_before, tier_after, is_test_data)
         VALUES ($1, $2, $3, $4, 'x402', 'x402', $5)`,
        [creditedKey, txHash, creditUsdt, payer.toLowerCase(), isTest]
      );
      const upd = await client.query(
        `UPDATE api_credits
            SET credits_usdt    = COALESCE(credits_usdt, 0) + $1,
                total_deposited = COALESCE(total_deposited, 0) + $1,
                tier            = CASE WHEN tier = 'free' THEN 'x402' ELSE tier END,
                daily_limit     = GREATEST(COALESCE(daily_limit, 0), $2)
          WHERE api_key = $3
          RETURNING credits_usdt`,
        [creditUsdt, bundleCalls, creditedKey]
      );
      balanceAfter = parseFloat(upd.rows[0].credits_usdt);
    }

    await client.query(
      `INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
       VALUES ('x402', $1, 'USDC', $2, $3, $4, $5, $6)`,
      [amountUsd, network, txHash, payer, creditedKey, isTest]
    );
    // created_at is epoch seconds and status 'completed', mirroring
    // rpc_billing.js so downstream revenue queries see a consistent shape.
    // request_id 'x402:<tx>' rides the existing unique index as a third
    // duplicate guard.
    await client.query(
      `INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source, demand_source, is_test_data)
       VALUES ('rpc_call', $1, $2, 'completed', $3, $4, $5, null, 'x402', 'x402', $6)`,
      [payer, amountUsd, `x402:${txHash}`, Math.floor(Date.now() / 1000), network, isTest]
    );
    // M3 shadow ledger — flag-gated (default OFF), isolated pool (NOT this
    // transaction's client), never throws. Same request_id so it parity-matches.
    shadowWriteRevenueLedger(pool, { requestId: `x402:${txHash}`, amountUsdt: amountUsd, isTestData: isTest });

    // M6 shadow ledger — Draw
    shadowWriteDraw(pool, { txHash, payer, amountUsd, isTestData: isTest, network });

    await client.query('COMMIT');
    return {
      creditedKey,
      balanceAfter,
      // epsilon before floor: 0.03/0.00003 is 999.9999… in IEEE-754 — a
      // fresh 1000-call bundle must report 1000, not 999.
      callsRemaining: balanceAfter != null ? Math.floor(balanceAfter / PRICE_PER_CALL_USDT + 1e-6) : null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new DuplicateSettlementError(txHash);
    throw err;
  } finally {
    client.release();
  }
}
