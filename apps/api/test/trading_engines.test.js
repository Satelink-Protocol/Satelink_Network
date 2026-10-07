import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  barsFromCandles, computeFeature, featureSnapshot, returns, volatility, vwap, isqrt, sqrtFx,
  classifyRegime, Regime, analyzeLiquidity, assessDataConfidence, REGIME_CONFIG, LIQUIDITY_CONFIG, DATA_CONFIDENCE_CONFIG,
} from '../src/trading_agent/engines/index.mjs';
import { computeIndicator } from '../src/trading_agent/strategies/indicators.mjs';
import { fx, toDecimal } from '../src/trading_agent/strategies/fixed.mjs';
import { normalizeCandle, normalizeQuote } from '../src/trading_agent/market_data/types.mjs';

// Phase 6 item 4 — deterministic engines. Synthetic data; expected values computed by hand.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const T0 = Date.UTC(2026, 9, 1);
const H = 3_600_000;

/** closes → normalized 1h candles (decimal strings), with optional per-bar overrides. */
function candles(closes, { volume = '10', wick = '0.002', overrides = {}, skip = [] } = {}) {
  const out = [];
  let prev = closes[0];
  closes.forEach((c, i) => {
    if (skip.includes(i)) { prev = c; return; }
    const close = Number(c); const open = Number(prev);
    const hi = Math.max(open, close) * (1 + Number(wick)); const lo = Math.min(open, close) * (1 - Number(wick));
    const o = overrides[i] ?? {};
    out.push(normalizeCandle({
      venue: 'binance', instrument: 'BTCUSDT', interval: '1h', openTime: new Date(T0 + i * H).toISOString(),
      open: o.open ?? open.toFixed(8), high: o.high ?? hi.toFixed(8), low: o.low ?? lo.toFixed(8), close: close.toFixed(8),
      volume, closed: true, updatedAt: new Date(T0 + (i + 1) * H).toISOString(),
    }));
    prev = c;
  });
  return out;
}
const series = (n, f) => Array.from({ length: n }, (_, i) => f(i));

describe('trading: deterministic engines (Phase 6 item 4)', () => {
  describe('features', () => {
    it('isqrt / sqrtFx are exact', () => {
      expect(isqrt(0n)).to.equal(0n); expect(isqrt(15n)).to.equal(3n); expect(isqrt(16n)).to.equal(4n); expect(isqrt(10n ** 36n)).to.equal(10n ** 18n);
      expect(toDecimal(sqrtFx(fx('0.0004')))).to.equal('0.02');
      expect(toDecimal(sqrtFx(fx('2')))).to.equal('1.414213562373095048');
    });

    it('returns, volatility and VWAP match hand-computed values', () => {
      const b = barsFromCandles(candles(['100', '110', '99'], { wick: '0' }));
      expect(returns(b).map((x) => (x == null ? null : toDecimal(x)))).to.deep.equal([null, '0.1', '-0.1']);
      expect(toDecimal(volatility(b, 2)[2])).to.equal('0.1'); // returns 0.1, −0.1 → mean 0 → stdev 0.1
      expect(toDecimal(volatility(barsFromCandles(candles(['100', '110', '121'], { wick: '0' })), 2)[2])).to.equal('0'); // constant +10% → stdev 0 (mean is subtracted)
      const v = barsFromCandles([
        { open: '10', high: '12', low: '9', close: '9', volume: '1', openTime: 'a' },
        { open: '9', high: '15', low: '9', close: '12', volume: '3', openTime: 'b' },
      ]);
      // typical prices 10 and 12; VWAP = (10×1 + 12×3) / 4 = 11.5
      expect(toDecimal(vwap(v, 2)[1])).to.equal('11.5');
      expect(vwap(barsFromCandles([{ open: '1', high: '1', low: '1', close: '1', volume: '0' }]), 1)[0]).to.equal(null);
    });

    it('Stage 13 types delegate bit-identically to the strategy evaluator (one engine for backtest, paper and live)', () => {
      const b = barsFromCandles(candles(series(80, (i) => String(100 + 5 * Math.sin(i / 3) + i * 0.2))));
      for (const spec of [{ type: 'sma', period: 10, source: 'close' }, { type: 'ema', period: 12, source: 'close' }, { type: 'rsi', period: 14, source: 'close' }, { type: 'atr', period: 14 }, { type: 'highest', period: 5, source: 'high' }]) {
        expect(computeFeature(spec, b), spec.type).to.deep.equal(computeIndicator(spec, b));
      }
    });

    it('is deterministic and returns decimal strings', () => {
      const b = barsFromCandles(candles(series(30, (i) => String(100 + i))));
      const specs = { ema10: { type: 'ema', period: 10 }, vol10: { type: 'volatility', period: 10 }, vwap5: { type: 'vwap', period: 5 }, rsi50: { type: 'rsi', period: 50 } };
      const a = featureSnapshot(b, specs);
      expect(featureSnapshot(b, specs)).to.deep.equal(a);
      expect(a.rsi50).to.equal(null); // warming up
      expect(a.ema10).to.match(/^\d+(\.\d+)?$/);
      expect(() => computeFeature({ type: 'macd' }, b)).to.throw(/unknown feature/);
    });
  });

  describe('regime', () => {
    const at = (closes, opts, ctx) => classifyRegime(barsFromCandles(candles(closes, opts)), ctx);
    it('steady 1%/bar rise → trending up; config version stamped', () => {
      const r = at(series(80, (i) => (100 * 1.01 ** i).toFixed(6)));
      expect(r).to.include({ primary: Regime.TRENDING, direction: 'up', configVersion: REGIME_CONFIG.version });
      expect(at(series(80, (i) => (100 * 0.99 ** i).toFixed(6))).direction).to.equal('down');
    });
    it('small oscillation around a level → ranging (and low_vol when very quiet)', () => {
      const r = at(series(80, (i) => (100 + 0.2 * Math.sin(i)).toFixed(6)));
      expect(r.primary).to.equal(Regime.RANGING);
      expect(r.labels).to.deep.equal([Regime.RANGING, Regime.LOW_VOL]);
    });
    it('±5% swings → high_vol label', () => {
      const r = at(series(80, (i) => (i % 2 ? '105' : '100')));
      expect(r.volatility).to.equal(Regime.HIGH_VOL);
    });
    it('a crash bar (range ≥ 4 × ATR) or a 6% gap → abnormal', () => {
      const base = series(80, (i) => (100 + 0.2 * Math.sin(i)).toFixed(6));
      expect(at(base, { overrides: { 79: { high: '110', low: '90' } } }).primary).to.equal(Regime.ABNORMAL);
      const gapped = [...base.slice(0, 79), '106.5'];
      expect(at(gapped, { overrides: { 79: { open: '106', high: '107', low: '106' } } }).primary).to.equal(Regime.ABNORMAL);
    });
    it('short history or low data confidence → uncertain', () => {
      expect(at(series(30, (i) => String(100 + i))).primary).to.equal(Regime.UNCERTAIN);
      expect(at(series(80, (i) => (100 * 1.01 ** i).toFixed(6)), {}, { dataConfidence: 40 }).primary).to.equal(Regime.UNCERTAIN);
    });
  });

  describe('liquidity / spread', () => {
    const book = { bids: [['99.9', '10'], ['99.8', '20'], ['99', '100']], asks: [['100.1', '10'], ['100.2', '20'], ['101', '100']] };
    it('spread, mid, depth within ±50 bps, imbalance', () => {
      const l = analyzeLiquidity(book);
      expect(l).to.include({ mid: '100', spreadBps: '20', bidDepth: '2995', askDepth: '3005', configVersion: LIQUIDITY_CONFIG.version });
      expect(l.flags).to.deep.equal([]);
    });
    it('walks the book: average fill price and slippage vs mid', () => {
      const l = analyzeLiquidity(book, { side: 'buy', notional: '2005' }); // 1001 at 100.1 + 1004 at 100.2
      expect(l.fill).to.include({ fullyFillable: true });
      expect(Number(l.fill.avgPrice)).to.be.closeTo(100.15, 0.001);
      expect(Number(l.fill.slippageBps)).to.be.closeTo(15, 0.1);
    });
    it('flags insufficient liquidity (unfillable or thin vs 5× notional) and abnormal spread', () => {
      expect(analyzeLiquidity(book, { side: 'buy', notional: '1000000' }).flags).to.include('insufficient_liquidity');
      expect(analyzeLiquidity(book, { side: 'sell', notional: '1000' }).flags).to.include('insufficient_liquidity'); // 2995 < 5 × 1000
      expect(analyzeLiquidity({ bids: [['99', '1000']], asks: [['101', '1000']] }).flags).to.deep.equal(['abnormal_spread']); // 200 bps
    });
    it('rejects empty, crossed and unsorted books', () => {
      const c = (b) => { try { analyzeLiquidity(b); } catch (e) { return e.code; } return null; };
      expect(c({ bids: [], asks: [['1', '1']] })).to.equal('EMPTY_BOOK');
      expect(c({ bids: [['101', '1']], asks: [['100', '1']] })).to.equal('INVALID_BOOK');
      expect(c({ bids: [['99', '1'], ['99.5', '1']], asks: [['100', '1']] })).to.equal('INVALID_BOOK');
    });
  });

  describe('data confidence', () => {
    const now = new Date(T0 + 50 * H + 60_000);
    const cs = candles(series(50, (i) => String(100 + i)));
    const q = (bid, ask, ts = now) => normalizeQuote({ venue: 'binance', instrument: 'BTCUSDT', bid, ask, sourceTimestamp: ts.toISOString(), receivedAt: ts.toISOString() });
    it('fresh, complete, agreeing → 100', () => {
      const d = assessDataConfidence({ candles: cs, quotes: [q('148.99', '149.01')], now });
      expect(d).to.include({ score: 100, gaps: 0, duplicates: 0, configVersion: DATA_CONFIDENCE_CONFIG.version });
    });
    it('stale newest bar loses the freshness weight (40)', () => {
      expect(assessDataConfidence({ candles: cs, now: new Date(now.getTime() + 10 * H) }).score).to.equal(60);
    });
    it('missing bars reduce completeness; > 5% missing or any duplicate → 0', () => {
      const one = assessDataConfidence({ candles: candles(series(50, (i) => String(100 + i)), { skip: [10] }), now });
      expect(one.gaps).to.equal(1);
      expect(one.score).to.equal(86); // freshness 40 + completeness 35 × (1 − 0.02/0.05) = 21 + agreement 25 (single source)
      expect(assessDataConfidence({ candles: candles(series(50, (i) => String(100 + i)), { skip: [5, 10, 15] }), now }).parts.completeness).to.equal(0);
      expect(assessDataConfidence({ candles: [...cs.slice(0, 49), cs[48], cs[49]], now }).parts.completeness).to.equal(0);
    });
    it('sources disagreeing by ≥ 20 bps lose the agreement weight', () => {
      const d = assessDataConfidence({ candles: cs, quotes: [q('150', '150.2')], now }); // ~74 bps from 149
      expect(d.parts.agreement).to.equal(0);
      expect(d.issues.join(' ')).to.match(/sources disagree/);
    });
    it('no candles → 0', () => expect(assessDataConfidence({ candles: [], now }).score).to.equal(0));
  });

  it('engines are pure: no I/O, clock, randomness or floats', () => {
    const dir = path.join(ROOT, 'apps/api/src/trading_agent/engines');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).to.not.match(/node:fs|from 'pg'|fetch\(|Date\.now|new Date\(\)|Math\.random|parseFloat|process\.env/);
    }
  });
});
