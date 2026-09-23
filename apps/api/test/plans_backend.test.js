import { expect } from 'chai';
import { listPlans, getPlan } from '../src/plans/plans_service.mjs';
import {
  creditForPack, nextPeriodEnd, ensureFreeEntitlement, grantPlanAllowance,
  resetExpired, consumeEntitlement, getEntitlement, reconcileEntitlements,
  SUB_PLAN_MAP, FREE_INCLUDED_CALLS,
} from '../src/plans/entitlement_service.mjs';

// Mock pg pool: substring-matched SQL, canned rows. Records writes for asserting.
function makePool(handlers = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ s, params });
      for (const [needle, fn] of Object.entries(handlers)) {
        if (s.includes(needle)) return fn(params, s);
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('plans_service', () => {
  it('listPlans shapes catalogue rows', async () => {
    const pool = makePool({
      'FROM plans WHERE active': () => ({ rows: [
        { id: 'free', name: 'Free', price_monthly_usd: '0', price_yearly_usd: '0', included_calls: '300', overage_per_call_usd: null, api_keys: '1', rate_limit: 'low' },
        { id: 'pro', name: 'Pro', price_monthly_usd: '19', price_yearly_usd: '190', included_calls: '2500', overage_per_call_usd: '0.008', api_keys: '5', rate_limit: 'standard' },
      ] }),
    });
    const plans = await listPlans(pool);
    expect(plans).to.have.length(2);
    expect(plans[0]).to.deep.include({ id: 'free', includedCalls: 300, overagePerCall: null });
    expect(plans[1]).to.deep.include({ id: 'pro', includedCalls: 2500, overagePerCall: 0.008 });
    expect(plans[1].price).to.deep.equal({ monthly: 19, yearly: 190 });
  });

  it('getPlan returns a row or null', async () => {
    const pool = makePool({ 'FROM plans WHERE id': (p) => ({ rows: p[0] === 'pro' ? [{ id: 'pro' }] : [] }) });
    expect(await getPlan(pool, 'pro')).to.deep.equal({ id: 'pro' });
    expect(await getPlan(pool, 'nope')).to.equal(null);
  });
});

describe('entitlement_service — pure helpers', () => {
  it('creditForPack applies the bonus (§4.5)', () => {
    expect(creditForPack('starter')).to.equal(9.99);
    expect(creditForPack('pack-50')).to.equal(52.5);
    expect(creditForPack('pack-200')).to.equal(220);
    expect(creditForPack('unknown')).to.equal(null);
  });
  it('nextPeriodEnd advances one month', () => {
    const end = nextPeriodEnd(new Date('2026-01-15T00:00:00Z'));
    expect(end.getUTCMonth()).to.equal(1); // February
  });
  it('FREE_INCLUDED_CALLS is 300 and starter maps to a plan', () => {
    expect(FREE_INCLUDED_CALLS).to.equal(300);
    expect(SUB_PLAN_MAP.pro).to.equal('pro');
  });
});

describe('entitlement_service — DB ops (mock pool)', () => {
  it('consumeEntitlement decrements when allowance remains, else declines', async () => {
    const ok = makePool({ 'UPDATE plan_entitlements': () => ({ rows: [{ remaining: 42 }] }) });
    expect(await consumeEntitlement(ok, 'sk_1', 1)).to.deep.equal({ consumed: true, remaining: 42 });
    const empty = makePool({ 'UPDATE plan_entitlements': () => ({ rows: [] }) });
    expect(await consumeEntitlement(empty, 'sk_1', 1)).to.deep.equal({ consumed: false, remaining: 0 });
  });

  it('resetExpired returns the number of rolled-over rows', async () => {
    const pool = makePool({ 'UPDATE plan_entitlements e': () => ({ rowCount: 3 }) });
    expect(await resetExpired(pool)).to.equal(3);
  });

  it('grantPlanAllowance upserts source=plan with the plan id', async () => {
    const pool = makePool();
    await grantPlanAllowance(pool, 'sk_1', 'pro', 2500, new Date(), new Date());
    const w = pool.calls.find((c) => c.s.includes('INSERT INTO plan_entitlements'));
    expect(w.params[1]).to.equal('pro');
    expect(w.params[2]).to.equal(2500);
  });

  it('ensureFreeEntitlement grants the free quota with ON CONFLICT DO NOTHING', async () => {
    const pool = makePool();
    await ensureFreeEntitlement(pool, 'sk_1');
    const w = pool.calls.find((c) => c.s.includes('INSERT INTO plan_entitlements'));
    expect(w.s).to.include('DO NOTHING');
    expect(w.params[1]).to.equal(300);
  });

  it('getEntitlement computes remaining', async () => {
    const pool = makePool({ 'FROM plan_entitlements WHERE api_key': () => ({ rows: [{
      api_key: 'sk_1', plan_id: 'pro', source: 'plan', included_calls_total: 2500, included_calls_used: 100,
      period_start: null, period_end: null,
    }] }) });
    const e = await getEntitlement(pool, 'sk_1');
    expect(e.remaining).to.equal(2400);
    expect(e.planId).to.equal('pro');
  });

  it('reconcileEntitlements grants buckets for active subscriptions only', async () => {
    const pool = makePool({
      'FROM subscriptions': () => ({ rows: [
        { api_key: 'sk_pro', plan: 'pro', current_period_start: null, current_period_end: null },
        { api_key: 'sk_unknown', plan: 'weird', current_period_start: null, current_period_end: null },
      ] }),
      'FROM plans WHERE id': () => ({ rows: [{ included_calls: 2500 }] }),
      'INSERT INTO plan_entitlements': () => ({ rows: [] }),
    });
    const granted = await reconcileEntitlements(pool);
    expect(granted).to.equal(1); // only the mapped 'pro' subscription
  });
});
