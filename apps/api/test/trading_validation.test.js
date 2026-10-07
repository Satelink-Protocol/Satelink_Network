import { expect } from 'chai';
import { parseStrategyDsl } from '../src/trading_agent/strategies/index.mjs';
import { runBacktest } from '../src/trading_agent/backtest/index.mjs';
import {
  walkForward, stressTest, bootstrapTrades, applyGap, HYPOTHETICAL, VALIDATION_DISCLAIMER, WALK_FORWARD_CONFIG, STRESS_CONFIG,
} from '../src/trading_agent/validation/index.mjs';

// Phase 6 item 5 — walk-forward + stress / Monte Carlo on the real Stage 14 simulator. Synthetic data.
const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);
const PARAMS = (over = {}) => ({
  params: 'satelink.sim-params/1.0', initialCash: '10000', quoteCurrency: 'USDT',
  instruments: { 'BTC-USDT': { tickSize: '0.01', lotSize: '0.001', minQuantity: '0.001', minNotional: '1' } },
  fees: { takerBps: '10', makerBps: '2' }, slippageBps: '10', partialFills: { maxParticipationPct: '100' }, windowBars: 50, ...over,
});
const DSL = parseStrategyDsl({
  dsl: 'satelink.strategy/1.0', name: 'Band', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  entry: { cmp: { op: 'lt', left: { price: 'close' }, right: { const: '97' } } },
  exit: { cmp: { op: 'gt', left: { price: 'close' }, right: { const: '103' } } },
  position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '1' } }, risk: { stopLossPct: '50' },
});
/** Oscillating series: buys below 97, sells above 103, so trades recur in every window. */
function oscillating(n, { period = 12, amp = 5, drift = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + amp * Math.sin((2 * Math.PI * i) / period) + drift * i;
    const o = 100 + amp * Math.sin((2 * Math.PI * (i - 1)) / period) + drift * (i - 1);
    const f = (x) => x.toFixed(2);
    return { instrument: 'BTC-USDT', openTime: T0 + i * H, open: f(o), high: f(Math.max(o, c) + 0.3), low: f(Math.min(o, c) - 0.3), close: f(c), volume: '1000' };
  });
}
const WF = Object.freeze({ ...WALK_FORWARD_CONFIG, inSampleBars: 48, outOfSampleBars: 24, stepBars: 24, warmupBars: 12, minWindows: 3 });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

describe('trading: validation engines (Phase 6 item 5)', () => {
  describe('walk-forward', () => {
    const candles = oscillating(168);
    it('rolls IS/OOS windows over the history and labels the result HYPOTHETICAL', () => {
      const r = walkForward({ parsed: DSL, params: PARAMS(), candles }, WF);
      // (168 − 48 − 24) / 24 + 1 = 5 windows
      expect(r.summary.windows).to.equal(5);
      expect(r.windows.map((w) => [w.inSample.from, w.outOfSample.from])).to.deep.equal([0, 1, 2, 3, 4].map((k) => [new Date(T0 + k * 24 * H).toISOString(), new Date(T0 + (k * 24 + 48) * H).toISOString()]));
      expect(r).to.include({ label: HYPOTHETICAL, kind: 'walk_forward', configVersion: 'walk-forward/1.0', definitionHash: DSL.hash });
      expect(r.disclaimer).to.equal(VALIDATION_DISCLAIMER).and.match(/HYPOTHETICAL/);
      expect(r.summary.outOfSampleTrades).to.be.greaterThan(0);
    });

    it('counts only trades ENTERED inside each OOS window (warm-up trades excluded)', () => {
      const r = walkForward({ parsed: DSL, params: PARAMS(), candles }, WF);
      for (const w of r.windows) {
        const lo = Date.parse(w.outOfSample.from); const hi = lo + 24 * H;
        const all = runBacktest({ parsed: DSL, params: PARAMS(), candles: candles.filter((c) => c.openTime >= lo - 12 * H && c.openTime < hi) }).trades;
        expect(all.every((t) => typeof t.entryTime === 'number')).to.equal(true);
        expect(w.outOfSample.trades).to.equal(all.filter((t) => t.entryTime >= lo).length);
      }
    });

    it('anchored windows always start at bar 0 and grow', () => {
      const r = walkForward({ parsed: DSL, params: PARAMS(), candles }, { ...WF, anchored: true });
      expect(r.windows.map((w) => w.inSample.bars)).to.deep.equal([48, 72, 96, 120, 144]);
      expect(new Set(r.windows.map((w) => w.inSample.from)).size).to.equal(1);
    });

    it('is deterministic (same inputs → same resultHash)', () => {
      expect(walkForward({ parsed: DSL, params: PARAMS(), candles }, WF).resultHash).to.equal(walkForward({ parsed: DSL, params: PARAMS(), candles }, WF).resultHash);
    });

    it('efficiency is null (undefined, not "good") when the in-sample period made no money', () => {
      const flat = oscillating(168, { amp: 1 }); // never crosses 97/103 → no trades
      const r = walkForward({ parsed: DSL, params: PARAMS(), candles: flat }, WF);
      expect(r.summary.efficiency).to.equal(null);
      expect(r.summary.outOfSampleTrades).to.equal(0);
    });

    it('refuses too little history', () => {
      expect(code(() => walkForward({ parsed: DSL, params: PARAMS(), candles: oscillating(100) }, WF))).to.equal('INSUFFICIENT_HISTORY');
    });
  });

  describe('Monte Carlo bootstrap', () => {
    const base = { initialCash: '1000', iterations: 500, seed: 1, ruinDrawdownPct: '50' };
    it('is seeded: same seed → identical; different seed → different paths', () => {
      const trades = Array.from({ length: 25 }, (_, i) => ({ pnl: String((i * 37) % 53 - 26) }));
      const b = { ...base, iterations: 40 };
      expect(bootstrapTrades({ ...b, trades })).to.deep.equal(bootstrapTrades({ ...b, trades }));
      const seeds = [1, 2, 3, 4].map((seed) => { const r = bootstrapTrades({ ...b, trades, seed }); return JSON.stringify([r.finalEquity, r.maxDrawdownPct]); }); // distributions only (the result also echoes the seed)
      expect(new Set(seeds).size).to.be.greaterThan(1);
    });
    it('hand check: a single +10 trade repeated n times → every path ends at initial + 10n', () => {
      const r = bootstrapTrades({ ...base, trades: [{ pnl: '10' }, { pnl: '10' }, { pnl: '10' }] });
      expect(r.finalEquity).to.deep.equal({ p5: '1030', p50: '1030', p95: '1030' });
      expect(r.probabilityOfLossPct).to.equal('0');
      expect(r.maxDrawdownPct.p95).to.equal('0');
    });
    it('all-losing trades → P(loss) = 100%; deep losses count as ruin; percentiles ordered', () => {
      const r = bootstrapTrades({ ...base, trades: [{ pnl: '-300' }, { pnl: '-250' }] });
      expect(r.probabilityOfLossPct).to.equal('100');
      expect(r.probabilityOfRuinPct).to.equal('100'); // 2 × ≥250 from 1000 → ≥ 50% drawdown
      const m = bootstrapTrades({ ...base, trades: [{ pnl: '30' }, { pnl: '-20' }, { pnl: '5' }, { pnl: '-12' }, { pnl: '8' }] });
      expect(Number(m.finalEquity.p5)).to.be.at.most(Number(m.finalEquity.p50));
      expect(Number(m.finalEquity.p50)).to.be.at.most(Number(m.finalEquity.p95));
    });
    it('no trades → NO_TRADES', () => expect(code(() => bootstrapTrades({ ...base, trades: [] }))).to.equal('NO_TRADES'));
  });

  describe('stress', () => {
    const candles = oscillating(120);
    it('applyGap scales every price from the given bar onward, exactly', () => {
      const g = applyGap(candles, 60, '-0.1');
      expect(g[59]).to.deep.equal(candles[59]);
      expect(Number(g[60].close)).to.be.closeTo(Number(candles[60].close) * 0.9, 1e-9);
      expect(Number(g[119].high)).to.be.closeTo(Number(candles[119].high) * 0.9, 1e-9);
    });
    it('fee and slippage shocks never improve results; costs scale up', () => {
      const r = stressTest({ parsed: DSL, params: PARAMS(), candles });
      expect(r).to.include({ label: HYPOTHETICAL, kind: 'stress', configVersion: STRESS_CONFIG.version });
      const base = Number(r.baseline.netPnl);
      expect(r.feeShocks.map((s) => s.multiplier)).to.deep.equal(['2', '3']);
      for (const s of [...r.feeShocks, ...r.slippageShocks]) expect(Number(s.netPnl)).to.be.at.most(base);
      expect(Number(r.feeShocks[1].feesPaid)).to.be.greaterThan(Number(r.feeShocks[0].feesPaid));
      expect(Number(r.slippageShocks[1].slippageCost)).to.be.greaterThan(Number(r.baseline.slippageCost));
      expect(r.gapScenarios.map((s) => s.gap)).to.deep.equal(['-0.1', '-0.2', '0.1']);
      expect(r.bootstrap.iterations).to.equal(1000);
    });
    it('is deterministic and records the baseline it stressed', () => {
      const a = stressTest({ parsed: DSL, params: PARAMS(), candles });
      expect(stressTest({ parsed: DSL, params: PARAMS(), candles }).resultHash).to.equal(a.resultHash);
      expect(a.baselineResultHash).to.equal(runBacktest({ parsed: DSL, params: PARAMS(), candles }).resultHash);
    });
    it('a strategy with no trades has no bootstrap (null), never a fabricated distribution', () => {
      expect(stressTest({ parsed: DSL, params: PARAMS(), candles: oscillating(120, { amp: 1 }) }).bootstrap).to.equal(null);
    });
  });
});
