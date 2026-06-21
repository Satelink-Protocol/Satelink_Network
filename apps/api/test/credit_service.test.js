import { expect } from 'chai';
import {
  resolveAccount,
  authorizeAndMeter,
  creditAccount,
  costFor,
  PRICE_PER_CALL_USDT,
} from '../src/billing/credit_service.mjs';

// Minimal in-memory mock of a pg pool: one account row + a usage counter + a
// deposit set. SQL is matched by substring so the tests pin behavior, not text.
function makePool(account, { dailyCount = 0, deposits = new Set() } = {}) {
  const state = { account: account ? { ...account } : null, dailyCount, deposits, inserts: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('SELECT api_key, wallet_address') && s.includes('WHERE api_key')) {
        return { rows: state.account && state.account.api_key === params[0] ? [state.account] : [] };
      }
      if (s.startsWith('SELECT api_key, wallet_address') && s.includes('wallet_address')) {
        const w = String(params[0]).toLowerCase();
        return { rows: state.account && String(state.account.wallet_address).toLowerCase() === w ? [state.account] : [] };
      }
      if (s.includes('FROM api_usage_daily WHERE api_key')) {
        return { rows: [{ request_count: state.dailyCount }] };
      }
      if (s.startsWith('UPDATE api_credits') && s.includes('credits_usdt - $1')) {
        const cost = params[0];
        if (state.account.credits_usdt >= cost) {
          state.account.credits_usdt = +(state.account.credits_usdt - cost).toFixed(6);
          return { rowCount: 1, rows: [{ credits_usdt: state.account.credits_usdt }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (s.startsWith('UPDATE api_credits') && s.includes('last_used = NOW()') && !s.includes('credits_usdt -')) {
        return { rowCount: 1, rows: [] };
      }
      if (s.includes('INSERT INTO api_usage_daily')) {
        state.dailyCount += 1;
        state.inserts.push({ table: 'api_usage_daily', usd: params[1] });
        return { rowCount: 1, rows: [] };
      }
      if (s.includes('SELECT 1 FROM api_deposits WHERE tx_hash')) {
        return { rows: state.deposits.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      if (s.includes('INSERT INTO api_deposits')) {
        state.deposits.add(params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (s.startsWith('UPDATE api_credits') && s.includes('total_deposited')) {
        state.account.credits_usdt = +(state.account.credits_usdt + params[0]).toFixed(6);
        if (params[1]) state.account.tier = params[1];
        if (params[2]) state.account.daily_limit = params[2];
        return { rowCount: 1, rows: [{ credits_usdt: state.account.credits_usdt, tier: state.account.tier, daily_limit: state.account.daily_limit }] };
      }
      throw new Error('unexpected SQL: ' + s);
    },
  };
  return pool;
}

const FREE = { api_key: 'sk_free_' + 'a'.repeat(48), wallet_address: '0xAaa0000000000000000000000000000000000001', tier: 'free', daily_limit: 500, credits_usdt: 0, status: 'active' };
const PRO = { api_key: 'sk_pro_' + 'b'.repeat(48), wallet_address: '0xBbb0000000000000000000000000000000000002', tier: 'pro', daily_limit: 100000, credits_usdt: 1.0, status: 'active' };

describe('creditService — canonical api_credits source of truth', () => {

  describe('resolveAccount', () => {
    it('resolves by api_key', async () => {
      const acct = await resolveAccount(makePool(PRO), { apiKey: PRO.api_key });
      expect(acct).to.include({ tier: 'pro' });
    });
    it('resolves the SAME account by bound wallet (key + wallet → one account)', async () => {
      const acct = await resolveAccount(makePool(PRO), { wallet: PRO.wallet_address });
      expect(acct.api_key).to.equal(PRO.api_key);
    });
    it('returns null for an unknown principal', async () => {
      expect(await resolveAccount(makePool(PRO), { apiKey: 'sk_free_zzz' })).to.equal(null);
    });
  });

  describe('VERIFY: usage recorded per request', () => {
    it('free tier within limit → ok, usage incremented, no deduction', async () => {
      const pool = makePool(FREE, { dailyCount: 10 });
      const v = await authorizeAndMeter(pool, { apiKey: FREE.api_key });
      expect(v.ok).to.equal(true);
      expect(v.cost).to.equal(0);
      expect(pool.state.dailyCount).to.equal(11);               // metered
      expect(pool.state.account.credits_usdt).to.equal(0);       // free not charged
    });
  });

  describe('VERIFY: credits deducted per request', () => {
    it('paid tier deducts exactly one call cost and meters usage', async () => {
      const pool = makePool(PRO, { dailyCount: 0 });
      const v = await authorizeAndMeter(pool, { apiKey: PRO.api_key });
      expect(v.ok).to.equal(true);
      expect(v.cost).to.equal(PRICE_PER_CALL_USDT);
      expect(pool.state.account.credits_usdt).to.equal(+(1.0 - PRICE_PER_CALL_USDT).toFixed(6));
      expect(pool.state.dailyCount).to.equal(1);
    });
    it('paid tier with zero balance → 402, no usage recorded', async () => {
      const pool = makePool({ ...PRO, credits_usdt: 0 });
      const v = await authorizeAndMeter(pool, { apiKey: PRO.api_key });
      expect(v.ok).to.equal(false);
      expect(v.http).to.equal(402);
      expect(v.code).to.equal('insufficient_credits');
      expect(pool.state.dailyCount).to.equal(0);
    });
    it('never drives balance negative under exact-boundary cost', async () => {
      const pool = makePool({ ...PRO, credits_usdt: PRICE_PER_CALL_USDT });
      const v1 = await authorizeAndMeter(pool, { apiKey: PRO.api_key });
      expect(v1.ok).to.equal(true);
      expect(pool.state.account.credits_usdt).to.equal(0);
      const v2 = await authorizeAndMeter(pool, { apiKey: PRO.api_key });
      expect(v2.ok).to.equal(false);
      expect(v2.http).to.equal(402);
    });
  });

  describe('authorization gates', () => {
    it('daily limit exceeded → 429', async () => {
      const v = await authorizeAndMeter(makePool(FREE, { dailyCount: 500 }), { apiKey: FREE.api_key });
      expect(v.ok).to.equal(false);
      expect(v.http).to.equal(429);
      expect(v.code).to.equal('daily_limit_exceeded');
    });
    it('unknown account → 401 (no silent anonymous downgrade)', async () => {
      const v = await authorizeAndMeter(makePool(PRO), { apiKey: 'sk_free_unknown' });
      expect(v.ok).to.equal(false);
      expect(v.http).to.equal(401);
    });
    it('inactive account → 403', async () => {
      const v = await authorizeAndMeter(makePool({ ...PRO, status: 'suspended' }), { apiKey: PRO.api_key });
      expect(v.http).to.equal(403);
    });
    it('authorizes a paid caller by WALLET, deducting the same account balance', async () => {
      const pool = makePool(PRO);
      const v = await authorizeAndMeter(pool, { wallet: PRO.wallet_address });
      expect(v.ok).to.equal(true);
      expect(pool.state.account.credits_usdt).to.be.below(1.0);
    });
  });

  describe('VERIFY: deposit increases balance (same account, idempotent)', () => {
    it('manual deposit raises credits_usdt', async () => {
      const pool = makePool({ ...PRO, credits_usdt: 0 });
      const r = await creditAccount(pool, { apiKey: PRO.api_key, amountUsdt: 9, txHash: '0xabc', tier: 'basic', dailyLimit: 10000 });
      expect(r.ok).to.equal(true);
      expect(r.balance).to.equal(9);
      expect(pool.state.account.credits_usdt).to.equal(9);
    });
    it('on-chain (wallet-resolved) deposit credits the SAME account as the key', async () => {
      const pool = makePool({ ...PRO, credits_usdt: 0 });
      const r = await creditAccount(pool, { wallet: PRO.wallet_address, amountUsdt: 5, txHash: '0xdef' });
      expect(r.ok).to.equal(true);
      expect(r.apiKey).to.equal(PRO.api_key);
      expect(pool.state.account.credits_usdt).to.equal(5);
    });
    it('the same tx_hash cannot be credited twice (no double-credit)', async () => {
      const pool = makePool({ ...PRO, credits_usdt: 0 });
      await creditAccount(pool, { apiKey: PRO.api_key, amountUsdt: 9, txHash: '0xsame' });
      const second = await creditAccount(pool, { apiKey: PRO.api_key, amountUsdt: 9, txHash: '0xsame' });
      expect(second.ok).to.equal(false);
      expect(second.code).to.equal('tx_already_used');
      expect(pool.state.account.credits_usdt).to.equal(9);  // not 18
    });
  });

  describe('costFor', () => {
    it('free tier always costs 0', () => expect(costFor(FREE)).to.equal(0));
    it('paid tier uses flat price by default', () => expect(costFor(PRO)).to.equal(PRICE_PER_CALL_USDT));
    it('paid tier honors a method override', () => expect(costFor(PRO, 0.001)).to.equal(0.001));
  });
});
