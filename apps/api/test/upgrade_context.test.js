// Conversion patch — personalized upgrade context on wall 402s.
//
// t1  offer math is honest: costs derive from unit prices in the same
//     response; prepaid recommended at volume, bundle only for tiny usage
//     (friction), with the per-call truth stated either way
// t2  x402 disabled → bundle option absent, never invented
// t3  context: history fields null-with-basis-label before the cache fills;
//     personalized after; rotation message only when >1 active IP in the /24
// t4  gate integration: over-limit anonymous 402 carries the upgrade block
//     with the caller's own counter; free-tier limit itself unchanged
// t5  stage counters: cz:seen bumped on wall 402, day-keyed with TTL

import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('conversion patch — upgrade context', function () {
  this.timeout(20000);

  let computeUpgradeOffer, createUpgradeContext;

  before(async () => {
    process.env.FREE_TIER_DAILY_LIMIT = '2'; // trip the gate on call 3 (set before gate import)
    process.env.X402_ENABLED = 'true';
    ({ computeUpgradeOffer, createUpgradeContext } = await import('../src/middleware/upgrade_context.js'));
  });

  after(() => {
    delete process.env.X402_ENABLED;
  });

  describe('t1 offer math honesty', () => {
    it('high volume → prepaid recommended, both costs re-derivable from stated unit prices', () => {
      const offer = computeUpgradeOffer(462_450); // ≈ the 15.4k/day Hetzner lead
      const prepaid = offer.options.find(o => o.plan === 'prepaid_credits');
      const bundle = offer.options.find(o => o.plan === 'x402_bundle');
      expect(prepaid.est_monthly_cost_usd).to.be.closeTo(462_450 * 0.00003, 1e-9); // 13.8735
      expect(bundle.est_monthly_cost_usd).to.be.closeTo(Math.ceil(462_450 / 1000) * 0.10, 1e-9); // 46.30
      expect(offer.recommended_plan).to.equal('prepaid_credits');
      expect(offer.best_available_option).to.equal('prepaid_credits');
      expect(offer.reason).to.include('$13.8735');
      expect(offer.reason).to.not.match(/sav(e|ings)|cheaper than (alchemy|the market)/i);
    });

    it('tiny volume → bundle recommended on friction, prepaid truth still stated', () => {
      const offer = computeUpgradeOffer(3000); // $0.09 prepaid < $0.50 min deposit
      expect(offer.recommended_plan).to.equal('x402_bundle');
      expect(offer.reason).to.include('minimum deposit');
      expect(offer.reason).to.include('cheaper per call'); // prepaid's advantage not hidden
    });

    it('never emits NaN/negative for garbage input', () => {
      for (const v of [NaN, -5, null, undefined, 'x']) {
        const o = computeUpgradeOffer(v);
        expect(o.estimated_monthly_calls).to.equal(0);
        expect(o.options[0].est_monthly_cost_usd).to.equal(0);
      }
    });
  });

  describe('t2 x402 disabled', () => {
    it('bundle option absent when the rail is off', () => {
      process.env.X402_ENABLED = 'false';
      try {
        const offer = computeUpgradeOffer(100_000);
        expect(offer.options.map(o => o.plan)).to.deep.equal(['prepaid_credits']);
        expect(offer.recommended_plan).to.equal('prepaid_credits');
      } finally { process.env.X402_ENABLED = 'true'; }
    });
  });

  describe('t3 personalization + rotation', () => {
    it('history null with basis label before fill; personalized + migration after', async () => {
      const pool = {
        query: async (sql, params) => {
          if (/developer_intel WHERE ip =/.test(sql)) return { rows: [{ days_active: 23, avg_daily: 15415 }] };
          if (/COUNT\(\*\)::int AS ips/.test(sql)) return { rows: [{ ips: 4 }] };
          return { rows: [] };
        },
      };
      const ctxFor = createUpgradeContext({ pool, redis: null });

      const first = ctxFor({ ip: '65.108.122.248', requestsToday: 501, subnet: '65.108.122' });
      expect(first.days_active).to.equal(null);
      expect(first.basis).to.include("today's live counter only");
      expect(first.estimated_monthly_calls).to.equal(501 * 30);

      await new Promise(r => setTimeout(r, 30)); // let the background fill land
      const second = ctxFor({ ip: '65.108.122.248', requestsToday: 501, subnet: '65.108.122' });
      expect(second.days_active).to.equal(23);
      expect(second.estimated_monthly_calls).to.equal(15415 * 30);
      expect(second.migration.detected).to.include('4 IPs');
      expect(second.migration.message).to.include('Replace multiple free endpoints with one paid authenticated endpoint');
    });

    it('no rotation message for a single-IP subnet', async () => {
      const pool = {
        query: async (sql) =>
          /COUNT\(\*\)::int AS ips/.test(sql) ? { rows: [{ ips: 1 }] } : { rows: [] },
      };
      const ctxFor = createUpgradeContext({ pool, redis: null });
      ctxFor({ ip: '1.2.3.4', requestsToday: 600, subnet: '1.2.3' });
      await new Promise(r => setTimeout(r, 30));
      const ctx = ctxFor({ ip: '1.2.3.4', requestsToday: 600, subnet: '1.2.3' });
      expect(ctx.migration).to.equal(undefined);
    });
  });

  describe('t4 gate integration', () => {
    it('the over-limit 402 carries the upgrade block; limit itself unchanged', async () => {
      const { createFreeTierGate } = await import('../src/middleware/free_tier_gate.js');
      const gate = createFreeTierGate({ info() {}, warn() {}, error() {} }, null, null); // no redis/pool
      const app = express();
      app.use(express.json());
      app.use(gate);
      app.post('/', (_req, res) => res.json({ served: true }));

      const call = () => request(app).post('/').set('X-Forwarded-For', '9.9.9.9')
        .send({ jsonrpc: '2.0', method: 'eth_blockNumber', id: 7 });

      // The gate reads FREE_TIER_DAILY_LIMIT at module load, and another test
      // file may have imported it first with a different value — exhaust
      // dynamically instead of assuming the limit (same pattern as
      // x402_rail.test.js). First call must serve (free tier alive).
      expect((await call()).status).to.equal(200);
      let walled, calls = 1;
      for (; calls <= 600; calls++) {
        const res = await call();
        if (res.status === 402) { walled = res; break; }
        expect(res.status).to.equal(200);
      }
      expect(walled, 'gate never tripped within 600 calls').to.exist;
      expect(walled.body.upgrade).to.be.an('object');
      expect(walled.body.upgrade.requests_today).to.equal(calls + 1);
      expect(walled.body.upgrade.options[0].plan).to.equal('prepaid_credits');
      expect(walled.body.upgrade.reason).to.be.a('string');
      // pre-existing 402 contract intact
      expect(walled.body.error.data.error_code).to.equal('FREE_TIER_LIMIT_REACHED');
      expect(walled.body.deposit.minimum_usdt).to.equal('0.50');
    });
  });

  describe('t5 stage counters', () => {
    it('cz:seen bumped, day-keyed, TTL set', async () => {
      const calls = [];
      const redis = {
        incr: async (k) => { calls.push(['incr', k]); return 1; },
        expire: async (k, ttl) => { calls.push(['expire', k, ttl]); return 1; },
      };
      const { bumpConversionStage } = await import('../src/middleware/upgrade_context.js');
      bumpConversionStage(redis, 'seen');
      await new Promise(r => setTimeout(r, 10));
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      expect(calls[0]).to.deep.equal(['incr', `cz:seen:${day}`]);
      expect(calls[1][2]).to.equal(8 * 24 * 3600);
    });
  });
});
