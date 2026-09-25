// Account-level spend controls in the metering path (CONSOLE_ACCOUNTS_V1).
//
// Called by authorizeAndMeter INSTEAD of its single deduction UPDATE when the
// flag is on. One transaction, in a fixed lock order
//     agent-day → agent-month → account-month counter → api_credits row
// so concurrent requests can neither exceed a cap nor deadlock:
//   1. read the key's link, agent limits and account settings;
//   2. paused agent → 403, product outside the agent's scopes → 403,
//      credit auto-use off → 402 (checked before anything is written);
//   3. conditional upsert on the agent's daily counter  (cap → 402);
//   4. conditional upsert on the account's monthly counter (cap → 402);
//   5. the SAME conditional credit deduction authorizeAndMeter always ran;
//   6. COMMIT — or ROLLBACK on any denial, so counters only ever move together
//      with a committed charge (counter == Σ committed charges, never > cap).
// Every denial here is `terminal`: enforceCapacity must not fall through to
// another payment layer for a paused / capped agent.
import { ensureConsoleAccountsSchema } from './schema.mjs';
import { isUsageLimitsV2Enabled, meterIntelligence } from '../pricing_v2/metering.mjs';

const DENY = {
  agent_paused: { http: 403, message: 'This key is paused by its owner — resume it in the console' },
  scope_denied: { http: 403, message: 'This key is not allowed to use this product — change its scopes in the console' },
  credit_auto_use_off: { http: 402, message: 'Credit auto-use is off for this account — turn it on in console settings' },
  agent_daily_cap_reached: { http: 402, message: "This key reached its daily spend cap — it resets at midnight in the account's timezone" },
  agent_monthly_cap_reached: { http: 402, message: 'This key reached its monthly spend cap — raise it in the console' },
  account_monthly_cap_reached: { http: 402, message: 'This account reached its monthly spend cap — raise it in console settings' },
};

function deny(code, extra = {}) {
  return { ok: false, code, terminal: true, ...DENY[code], ...extra };
}

const CONTEXT_SQL = `
  SELECT c.id AS api_key_id,
         l.account_id,
         al.paused, al.scopes, al.daily_cap_usdt, al.monthly_cap_usdt AS agent_monthly_cap_usdt,
         s.monthly_spend_cap_usdt,
         COALESCE(s.credit_auto_use, TRUE) AS credit_auto_use,
         COALESCE(s.timezone, 'UTC')       AS tz
    FROM api_credits c
    LEFT JOIN account_api_keys l ON l.api_key_id = c.id AND l.revoked_at IS NULL
    LEFT JOIN agent_limits    al ON al.api_key_id = c.id
    LEFT JOIN account_settings s ON s.account_id = l.account_id
   WHERE c.api_key = $1`;

// Conditional upsert: only succeeds when the new total stays within the cap.
// Under concurrency Postgres re-evaluates the DO UPDATE ... WHERE against the
// latest committed row version, so two requests can never both pass the cap.
const COUNTER_SQL = `
  INSERT INTO account_spend_counters (scope, scope_id, period, spent_usdt)
  SELECT $1, $2, to_char(NOW() AT TIME ZONE $3, $4), $5::numeric
   WHERE $5::numeric <= $6::numeric
  ON CONFLICT (scope, scope_id, period) DO UPDATE
     SET spent_usdt = account_spend_counters.spent_usdt + EXCLUDED.spent_usdt,
         updated_at = NOW()
   WHERE account_spend_counters.spent_usdt + EXCLUDED.spent_usdt <= $6::numeric
  RETURNING spent_usdt`;

const DEDUCT_SQL = `
  UPDATE api_credits
     SET credits_usdt = credits_usdt - $1,
         total_spent  = COALESCE(total_spent, 0) + $1,
         last_used    = NOW()
   WHERE api_key = $2 AND credits_usdt >= $1
   RETURNING credits_usdt`;

/**
 * @returns {Promise<{ok:true, balanceAfter:number|null, accountId:string|null}
 *                  | {ok:false, code, http, message, terminal?:true}>}
 *   balanceAfter is null when cost is 0 (no deduction ran).
 */
export async function deductWithAccountLimits(pool, { key, cost, product = 'rpc' }) {
  // Cached after the first call; a failure here throws → the gateway fails closed.
  await ensureConsoleAccountsSchema(pool);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    const ctx = (await client.query(CONTEXT_SQL, [key])).rows[0];
    if (!ctx) {
      await client.query('ROLLBACK');
      open = false;
      return { ok: false, code: 'account_not_found', http: 401, message: 'Unknown API key or wallet' };
    }

    const finish = async (result) => {
      await client.query(result.ok ? 'COMMIT' : 'ROLLBACK');
      open = false;
      return result;
    };

    if (ctx.paused) return finish(deny('agent_paused'));
    if (Array.isArray(ctx.scopes) && !ctx.scopes.includes(product)) return finish(deny('scope_denied', { product }));

    // Pricing V2 (SATELINK_USAGE_LIMITS_V2_ENABLED): Trading Intelligence on a
    // linked key draws plan UU → pack UU first; only the remainder reaches the
    // crypto-credit deduction below. Dodo-funded value never pays for RPC.
    let v2 = null;
    if (isUsageLimitsV2Enabled() && product === 'intelligence' && ctx.account_id) {
      v2 = await meterIntelligence(client, { accountId: ctx.account_id, apiKeyId: ctx.api_key_id, tz: ctx.tz, creditAutoUse: ctx.credit_auto_use !== false });
      if (v2.stop) {
        const { recordCredits, ...stop } = v2;
        return finish({ ok: false, ...stop });
      }
      if (v2.covered) {
        await client.query('UPDATE api_credits SET last_used = NOW() WHERE api_key = $1', [key]);
        return finish({ ok: true, balanceAfter: null, accountId: ctx.account_id, effectiveCost: 0, uu: { bucket: v2.bucket, units: v2.uu, usage: v2.usage } });
      }
    } else if (cost > 0 && ctx.account_id && ctx.credit_auto_use === false) {
      return finish(deny('credit_auto_use_off'));
    }

    if (cost > 0 && ctx.daily_cap_usdt !== null && ctx.daily_cap_usdt !== undefined) {
      const r = await client.query(COUNTER_SQL, ['agent_day', String(ctx.api_key_id), ctx.tz, 'YYYY-MM-DD', cost, ctx.daily_cap_usdt]);
      if (r.rowCount === 0) return finish(deny('agent_daily_cap_reached', { cap_usdt: Number(ctx.daily_cap_usdt) }));
    }
    if (cost > 0 && ctx.agent_monthly_cap_usdt !== null && ctx.agent_monthly_cap_usdt !== undefined) {
      const r = await client.query(COUNTER_SQL, ['agent_month', String(ctx.api_key_id), ctx.tz, 'YYYY-MM', cost, ctx.agent_monthly_cap_usdt]);
      if (r.rowCount === 0) return finish(deny('agent_monthly_cap_reached', { cap_usdt: Number(ctx.agent_monthly_cap_usdt) }));
    }
    if (cost > 0 && ctx.account_id && ctx.monthly_spend_cap_usdt !== null && ctx.monthly_spend_cap_usdt !== undefined) {
      const r = await client.query(COUNTER_SQL, ['account_month', ctx.account_id, ctx.tz, 'YYYY-MM', cost, ctx.monthly_spend_cap_usdt]);
      if (r.rowCount === 0) return finish(deny('account_monthly_cap_reached', { cap_usdt: Number(ctx.monthly_spend_cap_usdt) }));
    }

    if (cost > 0) {
      const ded = await client.query(DEDUCT_SQL, [cost, key]);
      if (ded.rowCount === 0) {
        return finish({ ok: false, code: 'insufficient_credits', http: 402, required_usdt: cost, message: 'Insufficient credits — deposit USDT to continue' });
      }
      if (v2?.recordCredits) await v2.recordCredits(cost);
      return finish({ ok: true, balanceAfter: parseFloat(ded.rows[0].credits_usdt), accountId: ctx.account_id, ...(v2 ? { uu: { bucket: 'credits', units: v2.uu, usage: v2.usage } } : {}) });
    }
    await client.query('UPDATE api_credits SET last_used = NOW() WHERE api_key = $1', [key]);
    return finish({ ok: true, balanceAfter: null, accountId: ctx.account_id });
  } catch (err) {
    if (open) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
