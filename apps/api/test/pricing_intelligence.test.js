// Autonomous Pricing Intelligence — engine + guard tests.
//
// t1  floor guard: no market/demand combination can push the recommendation
//     below the profit floor (the QUALITY BAR invariant)
// t2  step limiter: a single evaluation never moves price more than ±25%
// t3  decision logic: above-market + zero conversions → decrease toward
//     target median fraction; paid demand at/below median → hold
// t4  capacity strain → careful increase, still step-limited
// t5  market snapshot math: median/average over verified rows only,
//     unverified rows listed but excluded; break-even volumes computed
// t6  trust score: null data → component excluded + caveat, never invented;
//     bounds respected; single-node sample caveat present
// t7  price floor computation: env-driven, marginal-cost + platform-share math
// t8  /v1/pricing enrichment fails open — base body intact when intel throws
//
// No live Postgres needed: DB-facing functions get a scripted mock pool.

import { expect } from 'chai';
import { decidePrice } from '../src/economics/pricing_intelligence/pricing_brain.js';
import { computePriceFloor, enforceFloor, REVENUE_SPLIT } from '../src/economics/pricing_intelligence/price_floor.js';
import { computeMachinePreferenceScore } from '../src/economics/pricing_intelligence/trust_score.js';
import { getMarketSnapshot } from '../src/economics/pricing_intelligence/market_intel.js';
import { _resetEnsuredForTests } from '../src/economics/pricing_intelligence/schema.js';

const CURRENT = 0.00003;
const FLOOR = 0.00001;
const calmCapacity = { p50_latency_ms: 49, error_rate_pct: 0, availability_pct: 100 };

describe('pricing intelligence', function () {
  describe('t1 profit floor is inviolable', () => {
    it('clamps even an absurdly cheap market to the floor', () => {
      const d = decidePrice({
        current: 0.000012, // close enough to floor that a -25% step would cross it
        floor: FLOOR,
        marketMedianPerMillion: 0.01, // market at $0.01/M — a race to zero
        payments30d: 0,
        demandRequestsToday: 100000,
        capacity: calmCapacity,
      });
      expect(d.recommended).to.be.at.least(FLOOR);
      expect(d.clampedToFloor).to.equal(true);
      expect(d.reason).to.include('floor');
    });

    it('enforceFloor clamps NaN and negatives', () => {
      expect(enforceFloor(NaN, FLOOR).price).to.equal(FLOOR);
      expect(enforceFloor(-1, FLOOR).price).to.equal(FLOOR);
      expect(enforceFloor(0.5, FLOOR)).to.deep.equal({ price: 0.5, clamped: false });
    });
  });

  describe('t2 step limiter', () => {
    it('a decrease never exceeds 25% in one evaluation', () => {
      const d = decidePrice({
        current: CURRENT,
        floor: 0.000000001,
        marketMedianPerMillion: 3.0, // we are $30/M vs $3/M median — huge gap
        payments30d: 0,
        demandRequestsToday: 100000,
        capacity: calmCapacity,
      });
      expect(d.recommended).to.be.at.least(CURRENT * 0.75 - 1e-12);
      expect(d.stepLimited).to.equal(true);
      expect(d.action).to.equal('decrease');
    });
  });

  describe('t3 market/demand logic', () => {
    it('above market with zero paid conversion → decrease', () => {
      const d = decidePrice({
        current: CURRENT, floor: FLOOR, marketMedianPerMillion: 3.0,
        payments30d: 0, demandRequestsToday: 14800, capacity: calmCapacity,
      });
      expect(d.action).to.equal('decrease');
      expect(d.reason).to.include('0 paid conversions');
    });

    it('above market but converting → hold and observe', () => {
      const d = decidePrice({
        current: CURRENT, floor: FLOOR, marketMedianPerMillion: 3.0,
        payments30d: 5, demandRequestsToday: 14800, capacity: calmCapacity,
      });
      expect(d.action).to.equal('hold');
      expect(d.recommended).to.equal(CURRENT);
    });

    it('at/below median with paid demand → hold, never race to zero', () => {
      const d = decidePrice({
        current: 0.000002, floor: FLOOR / 10, marketMedianPerMillion: 3.0,
        payments30d: 12, demandRequestsToday: 50000, capacity: calmCapacity,
      });
      expect(d.action).to.equal('hold');
      expect(d.reason).to.include('never race to zero');
    });
  });

  describe('t4 capacity strain', () => {
    it('strained latency → careful increase, capped at +25%', () => {
      const d = decidePrice({
        current: CURRENT, floor: FLOOR, marketMedianPerMillion: 3.0,
        payments30d: 5, demandRequestsToday: 200000,
        capacity: { p50_latency_ms: 400, error_rate_pct: 1, availability_pct: 99 },
      });
      expect(d.action).to.equal('increase');
      expect(d.recommended).to.be.closeTo(CURRENT * 1.25, 1e-12);
    });
  });

  describe('t5 market snapshot math', () => {
    function mockPool(rows) {
      return {
        query: async (sql) => {
          if (/SELECT p\.slug/.test(sql)) return { rows };
          return { rows: [] }; // CREATE/INSERT during ensure/seed
        },
      };
    }
    const row = (slug, eff, conf, monthly) => ({
      slug, name: slug, pricing_model: 'per_request', plan_name: 'Plan',
      monthly_price_usd: monthly, included_requests_m: null,
      effective_usd_per_million: eff, free_tier_requests_m_per_month: null,
      requires_signup: true, requires_subscription: true, supports_x402: false,
      source_url: 'https://example.com', observed_at: new Date('2026-07-10'),
      confidence: conf, notes: null,
    });

    it('aggregates verified rows only; unverified listed but excluded', async () => {
      _resetEnsuredForTests();
      const snap = await getMarketSnapshot(
        mockPool([row('a', 1.0, 'published', 49), row('b', 3.0, 'derived_estimate', 49), row('c', null, 'unverified', null)]),
        CURRENT
      );
      expect(snap.verified_plans_in_sample).to.equal(2);
      expect(snap.market_median_usd_per_million).to.equal(2.0);
      expect(snap.market_average_usd_per_million).to.equal(2.0);
      expect(snap.providers).to.have.length(3);
      expect(snap.satelink.effective_usd_per_million).to.equal(30);
      // break-even: $49 / $0.00003 = 1,633,333 calls/month
      expect(snap.providers[0].breakeven_monthly_calls_vs_satelink).to.equal(1633333);
      expect(snap.position.per_million_vs_median_pct).to.be.greaterThan(0);
      expect(snap.position.summary).to.include('zero monthly commitment');
    });

    it('honest when we are cheaper than median', async () => {
      _resetEnsuredForTests();
      const snap = await getMarketSnapshot(mockPool([row('a', 100.0, 'published', 200)]), CURRENT);
      expect(snap.position.per_million_vs_median_pct).to.be.lessThan(0);
      expect(snap.position.summary).to.include('below the verified market median');
    });
  });

  describe('t6 trust score honesty', () => {
    const base = {
      p50LatencyMs: 49, availabilityPct: 100, errorRatePct: 0, healthSampleNodes: 1,
      ourPerMillionUsd: 30, marketMedianUsdPerMillion: 3.0,
      x402Enabled: true, minDepositUsd: 0.5,
    };

    it('scores bounded 0..100 with all components present', () => {
      const t = computeMachinePreferenceScore(base);
      expect(t.score).to.be.within(0, 100);
      for (const v of Object.values(t.components)) expect(v).to.be.within(0, 100);
      expect(t.caveats.join(' ')).to.include('1 node(s)');
    });

    it('missing health data → components null, excluded, caveated — never invented', () => {
      const t = computeMachinePreferenceScore({
        ...base, p50LatencyMs: null, availabilityPct: null, errorRatePct: null, healthSampleNodes: null,
      });
      expect(t.components.latency).to.equal(null);
      expect(t.components.uptime).to.equal(null);
      expect(t.components.reliability).to.equal(null);
      expect(t.score).to.be.within(0, 100); // renormalized over price + payment_ease
      expect(t.caveats.join(' ')).to.include('latency component unavailable');
    });

    it('above-market price scores below at-market price', () => {
      const expensive = computeMachinePreferenceScore(base).components.price;
      const cheap = computeMachinePreferenceScore({ ...base, ourPerMillionUsd: 1.5 }).components.price;
      expect(cheap).to.be.greaterThan(expensive);
    });
  });

  describe('t7 price floor computation', () => {
    afterEach(() => {
      delete process.env.MARGINAL_COST_PER_CALL_USD;
      delete process.env.PRICE_FLOOR_USD;
      delete process.env.INFRA_MONTHLY_COST_USD;
    });

    it('marginal cost is grossed up by the platform revenue share', () => {
      process.env.MARGINAL_COST_PER_CALL_USD = '0.00001';
      process.env.PRICE_FLOOR_USD = '0.000001';
      const f = computePriceFloor({ monthlyCallVolume: 450000, currentPricePerCall: CURRENT });
      expect(f.floor_price_usd).to.be.closeTo(0.00001 / REVENUE_SPLIT.platform, 1e-12);
      expect(f.x402_floor_price_usd).to.equal(0.001);
    });

    it('absolute floor dominates when marginal cost is zero', () => {
      process.env.MARGINAL_COST_PER_CALL_USD = '0';
      process.env.PRICE_FLOOR_USD = '0.00001';
      const f = computePriceFloor({ monthlyCallVolume: 450000, currentPricePerCall: CURRENT });
      expect(f.floor_price_usd).to.equal(0.00001);
      // break-even at current price: 25 / (0.00003 * 0.3) ≈ 2.78M calls/month
      expect(f.break_even_monthly_calls_at_current_price).to.equal(Math.ceil(25 / (CURRENT * REVENUE_SPLIT.platform)));
      expect(f.cost_recovery_price_usd).to.be.greaterThan(0);
    });
  });

  describe('t8 /v1/pricing fails open', () => {
    it('serves the base pricing body when intel throws', async () => {
      const { createMachineV1Router } = await import('../src/routes/machine_onboarding.js');
      // Pool whose intel queries all fail but whose ensure calls succeed —
      // enrichment must be skipped, base body served.
      const explodingPool = { query: async () => { throw new Error('db down'); } };
      const router = createMachineV1Router(explodingPool, null);
      const layer = router.stack.find(l => l.route && l.route.path === '/pricing');
      const body = await new Promise((resolve, reject) => {
        const res = {
          setHeader() {},
          json: resolve,
          status() { return this; },
        };
        layer.route.stack[0].handle({}, res, reject);
      });
      expect(body.ok).to.equal(true);
      expect(body.price_per_call_usdt).to.equal(CURRENT);
      expect(body.deposit.vault_address).to.be.a('string');
      // enrichment absent, not half-populated
      expect(body.machine_preference_score).to.equal(undefined);
    });
  });
});
