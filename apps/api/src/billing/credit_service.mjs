/**
 * creditService — the SINGLE source of truth for account identity, balance,
 * tier limits, usage metering, and deposit crediting.
 *
 * Canonical store: `api_credits` (+ `api_usage_daily`, `api_deposits`).
 * Both authentication methods resolve to the SAME account and the SAME balance:
 *   - X-API-Key      → api_credits.api_key
 *   - x-wallet-address → api_credits.wallet_address (bound wallet)
 *
 * Customer Zero P0 recovery (P0-2/P0-3/P0-4): the RPC serving path must
 * authorize, deduct, and meter through this module — never against Redis or
 * `credit_balances` independently.
 *
 * Invariants:
 *   1. One balance per account, deducted at most once per request.
 *   2. Deduction is atomic (UPDATE ... WHERE balance >= cost RETURNING) so two
 *      concurrent requests can never drive a balance negative.
 *   3. Free tier is gated by daily_limit only (cost 0); paid tiers are gated by
 *      both daily_limit and prepaid credit balance.
 *
 * Pure-ish: every function takes `pool` so it is unit-testable with a mock.
 */

import { isFounderWallet } from '../payments/founder_wallets.js';
import { isConsoleAccountsEnabled } from '../console_accounts/flag.mjs';
import { deductWithAccountLimits } from '../console_accounts/limits.mjs';

export const PRICE_PER_CALL_USDT = 0.000030;

// Per-tier daily request ceiling (rate limit). Mirrors credit_system TIERS.
export const TIER_DAILY_LIMIT = {
  free: 500,
  basic: 10000,
  pro: 100000,
  enterprise: 1000000,
};

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

function isApiKey(s) {
  return typeof s === 'string' && s.startsWith('sk_');
}

// payment_hold is a newer column (migration 033 / ensureBillingTables). Read it
// via to_jsonb(...)->>'payment_hold' so a DB that predates the column (a fresh
// test DB, or the prod boot window before ensureBillingTables runs) returns NULL
// instead of erroring — a plain "SELECT payment_hold" would raise 42703 and, in a
// caller's transaction, poison the whole transaction. Value comes back as text
// ('true'/'false') or null; isOnPaymentHold() normalizes it.
const ACCOUNT_COLS =
  `api_key, wallet_address, tier, daily_limit, credits_usdt, status, ` +
  `(to_jsonb(api_credits) ->> 'payment_hold') AS payment_hold`;

/** True iff the resolved account row is flagged payment_hold (text or boolean). */
export function isOnPaymentHold(account) {
  return account && (account.payment_hold === true || account.payment_hold === 'true');
}

/**
 * Resolve an account row from the canonical store by API key OR bound wallet.
 * Returns the api_credits row, or null if no account exists.
 */
export async function resolveAccount(pool, { apiKey, wallet } = {}) {
  if (!pool || !pool.query) return null;
  if (isApiKey(apiKey)) {
    const r = await pool.query(
      `SELECT ${ACCOUNT_COLS} FROM api_credits WHERE api_key = $1`,
      [apiKey]
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (wallet && WALLET_RE.test(wallet)) {
    const r = await pool.query(
      `SELECT ${ACCOUNT_COLS} FROM api_credits WHERE lower(wallet_address) = lower($1)
         ORDER BY created_at ASC LIMIT 1`,
      [wallet]
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

/** Today's request_count for a key (0 if none). */
export async function getDailyCount(pool, apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await pool.query(
    `SELECT request_count FROM api_usage_daily WHERE api_key = $1 AND date = $2`,
    [apiKey, today]
  );
  return parseInt(r.rows[0]?.request_count, 10) || 0;
}

/**
 * Per-call cost for an account + method.
 *
 * Free RPC removed (Phase 2, 2026-09 — "nothing is free, every RPC call is
 * paid"): EVERY tier is charged PRICE_PER_CALL_USDT per call (or a method
 * override), so an unfunded key hits the balance gate in authorizeAndMeter and
 * gets a 402 instead of a free ride. The "free" tier is now just a starter
 * account that must deposit before it can serve — daily_limit still caps it.
 *
 * Rollback lever (matches the free_tier_gate.js env-lever pattern): set
 * FREE_TIER_COST_ZERO=1 in Railway to restore cost-0 free-tier serving on the
 * container restart it triggers — no code redeploy. Read at call time.
 */
export function costFor(account, methodPrice) {
  if (!account) return 0;
  if (account.tier === 'free' && process.env.FREE_TIER_COST_ZERO === '1') return 0;
  return typeof methodPrice === 'number' ? methodPrice : PRICE_PER_CALL_USDT;
}

/**
 * Atomically record one served request: bump api_usage_daily and, for paid
 * accounts, decrement credits_usdt. Returns the verdict the gate acts on.
 *
 * @returns {Promise<{ok:true, tier, cost, balanceAfter, remaining}
 *                  | {ok:false, code, http, message, ...}>}
 */
export async function authorizeAndMeter(pool, { apiKey, wallet, methodPrice, product = 'rpc' } = {}) {
  if (!pool || !pool.query) {
    // Fail CLOSED (T-24): a DB outage must never mean free unlimited
    // service. Without a pool we cannot check the daily limit or deduct a
    // balance, so authorization cannot be granted — 503, not a free pass.
    return {
      ok: false, code: 'no_pool', http: 503,
      message: 'Billing store unavailable — try again shortly',
      degraded: true,
    };
  }

  const account = await resolveAccount(pool, { apiKey, wallet });
  if (!account) {
    return { ok: false, code: 'account_not_found', http: 401, message: 'Unknown API key or wallet' };
  }
  if (account.status && account.status !== 'active') {
    return { ok: false, code: 'account_inactive', http: 403, message: `Account status: ${account.status}` };
  }

  // Payment hold: a Dodo refund/dispute clawback could not be fully covered
  // (credits already spent). Block paid calls until an operator clears the hold.
  if (isOnPaymentHold(account)) {
    return {
      ok: false, code: 'payment_hold', http: 402,
      tier: account.tier, reason: 'payment_hold',
      message: 'Account is on payment hold (refund/dispute shortfall) — contact support',
    };
  }

  const key = account.api_key;
  const limit = account.daily_limit || TIER_DAILY_LIMIT[account.tier] || TIER_DAILY_LIMIT.free;

  // 1. Daily-limit (rate) gate — authoritative from Postgres usage.
  const used = await getDailyCount(pool, key);
  if (used >= limit) {
    return {
      ok: false, code: 'daily_limit_exceeded', http: 429,
      tier: account.tier, limit, used,
      message: `Daily request limit reached for tier ${account.tier} (${limit}/day)`,
    };
  }

  // 2. Balance gate (paid tiers only). Atomic deduct; never goes negative.
  let cost = costFor(account, methodPrice);
  let uuInfo = null;
  let balanceAfter = parseFloat(account.credits_usdt || 0);
  if (isConsoleAccountsEnabled() && typeof pool.connect === 'function') {
    // CONSOLE_ACCOUNTS_V1: pause / scope / credit auto-use / per-agent daily
    // cap / per-account monthly cap, checked and counted in ONE transaction
    // with the same conditional deduction as below (see limits.mjs).
    const g = await deductWithAccountLimits(pool, { key, cost, product });
    if (!g.ok) {
      return {
        ...g,
        tier: account.tier,
        ...(g.code === 'insufficient_credits' ? { balance_usdt: parseFloat(account.credits_usdt || 0) } : {}),
      };
    }
    if (g.balanceAfter !== null) balanceAfter = g.balanceAfter;
    // Pricing V2: a call covered by plan / pack UU costs nothing in credits —
    // report cost 0 so no second revenue row is written (the revenue was the
    // Dodo payment) and api_usage_daily records $0 for it.
    if (g.effectiveCost === 0) cost = 0;
    if (g.uu) uuInfo = g.uu;
  } else if (cost > 0) {
    const ded = await pool.query(
      `UPDATE api_credits
          SET credits_usdt = credits_usdt - $1,
              total_spent  = COALESCE(total_spent, 0) + $1,
              last_used    = NOW()
        WHERE api_key = $2 AND credits_usdt >= $1
        RETURNING credits_usdt`,
      [cost, key]
    );
    if (ded.rowCount === 0) {
      return {
        ok: false, code: 'insufficient_credits', http: 402,
        tier: account.tier, required_usdt: cost,
        balance_usdt: parseFloat(account.credits_usdt || 0),
        message: 'Insufficient credits — deposit USDT to continue',
      };
    }
    balanceAfter = parseFloat(ded.rows[0].credits_usdt);
  } else {
    // Free tier: keep last_used fresh without touching balance.
    await pool.query(`UPDATE api_credits SET last_used = NOW() WHERE api_key = $1`, [key]);
  }

  // 3. Usage metering — record the request (and usd spent) for this key/day.
  await pool.query(
    `INSERT INTO api_usage_daily (api_key, date, request_count, usdt_spent)
       VALUES ($1, CURRENT_DATE, 1, $2)
     ON CONFLICT (api_key, date) DO UPDATE
       SET request_count = api_usage_daily.request_count + 1,
           usdt_spent    = api_usage_daily.usdt_spent + $2`,
    [key, cost]
  );

  return {
    ok: true,
    tier: account.tier,
    cost,
    balanceAfter,
    remaining: Math.max(0, limit - used - 1),
    limit,
    apiKey: key,
    ...(uuInfo ? { uu: uuInfo } : {}),
  };
}

/**
 * Credit an account from a confirmed deposit. Used by BOTH the manual
 * /api/keys/deposit flow and the on-chain DepositListener (which resolves the
 * sender wallet → account). Idempotent on tx_hash via api_deposits UNIQUE.
 *
 * @returns {Promise<{ok:true, balance, credited} | {ok:false, code, message}>}
 */
export async function creditAccount(pool, { apiKey, wallet, amountUsdt, txHash, fromAddress, tier, dailyLimit } = {}) {
  if (!pool || !pool.query) return { ok: false, code: 'no_pool', message: 'no database' };
  const amount = parseFloat(amountUsdt);
  if (!(amount > 0)) return { ok: false, code: 'bad_amount', message: 'amount must be > 0' };

  const account = await resolveAccount(pool, { apiKey, wallet });
  if (!account) return { ok: false, code: 'account_not_found', message: 'no account for key/wallet' };
  const key = account.api_key;

  // Idempotency: a tx_hash credits exactly one account, once.
  if (txHash) {
    const dup = await pool.query(`SELECT 1 FROM api_deposits WHERE tx_hash = $1`, [txHash])
      .catch(() => ({ rows: [] }));
    if (dup.rows.length > 0) {
      return { ok: false, code: 'tx_already_used', message: 'transaction already credited' };
    }
  }

  const depositor = fromAddress || account.wallet_address || null;
  await pool.query(
    // credited_usdt == amount_usdt here: this path always credits 1:1 (no
    // bundle pricing). Only x402 bundle settlements (settlement.js) diverge.
    `INSERT INTO api_deposits (api_key, tx_hash, amount_usdt, credited_usdt, from_address, tier_before, tier_after, is_test_data)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
    [key, txHash || `internal_${Date.now()}`, amount, depositor,
     account.tier, tier || account.tier, isFounderWallet(depositor)]
  );

  const upd = await pool.query(
    `UPDATE api_credits
        SET credits_usdt    = COALESCE(credits_usdt, 0) + $1,
            total_deposited = COALESCE(total_deposited, 0) + $1,
            tier            = COALESCE($2, tier),
            daily_limit     = COALESCE($3, daily_limit)
      WHERE api_key = $4
      RETURNING credits_usdt, tier, daily_limit`,
    [amount, tier || null, dailyLimit || null, key]
  );

  return {
    ok: true,
    credited: amount,
    balance: parseFloat(upd.rows[0].credits_usdt),
    tier: upd.rows[0].tier,
    daily_limit: upd.rows[0].daily_limit,
    apiKey: key,
  };
}
