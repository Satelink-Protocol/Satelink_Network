import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrategyDsl, StrategyService, InMemoryStrategyStore, LifecycleState as LS, checkTransition } from '../src/trading_agent/strategies/index.mjs';
import {
  runBacktest, SimulationEngine, defineSimParams, marketCalendar, feeFor, slippedPrice, limitPriceFor, participationCap, limitFill,
  parityView, backtestEvidence, paperEvidence, BacktestJobService, InMemoryBacktestStore, SimError, DISCLAIMER, prepareHistory,
} from '../src/trading_agent/backtest/index.mjs';
import { PaperRunner, startPaperRun, stopPaperRun } from '../src/trading_agent/paper/index.mjs';
import { compileStrategy } from '../src/trading_agent/strategies/compiler.mjs';
import { fx, toDecimal } from '../src/trading_agent/strategies/fixed.mjs';
import { tradingFlagEnvName } from '../src/trading_agent/flags.mjs';

// Stage 14 — backtester + paper simulator. Pure: no network, no DB, no process.env.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TA = path.resolve(HERE, '../src/trading_agent');
const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 5); // Monday 2026-01-05 00:00Z

const BASE_PARAMS = (over = {}) => ({
  params: 'satelink.sim-params/1.0', initialCash: '1000', quoteCurrency: 'USDT',
  instruments: { 'BTC-USDT': { tickSize: '0.01', lotSize: '0.001', minQuantity: '0.001', minNotional: '1' } },
  fees: { takerBps: '10', makerBps: '2' }, slippageBps: '10', partialFills: { maxParticipationPct: '100' }, windowBars: 50,
  ...over,
});
const THRESHOLD_DSL = (over = {}) => ({
  dsl: 'satelink.strategy/1.0', name: 'Threshold', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  entry: { cmp: { op: 'gt', left: { price: 'close' }, right: { const: '105' } } },
  exit: { cmp: { op: 'lt', left: { price: 'close' }, right: { const: '95' } } },
  position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '1' } }, risk: { stopLossPct: '50' },
  ...over,
});
const bar = (i, o, h, l, c, v = '100', instrument = 'BTC-USDT') => ({ instrument, openTime: T0 + i * H, open: o, high: h, low: l, close: c, volume: v });
const SCENARIO = [
  bar(0, '100', '101', '99', '100'),
  bar(1, '100', '106', '99', '106'), // close > 105 → enter at close
  bar(2, '107', '109', '106', '108'), // market buy fills at open 107 + 10 bps → 107.107 → tick-up 107.11
  bar(3, '108', '109', '90', '94'), // close < 95 → exit at close
  bar(4, '93', '94', '92', '93'), // market sell fills at open 93 − 10 bps → 92.907 → tick-down 92.90
];
const codeOf = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

describe('backtest: fee / slippage / rounding maths', () => {
  it('fees are notional × bps / 10 000, exact, with maker rebates', () => {
    expect(toDecimal(feeFor(fx('107.11'), fx('10')))).to.equal('0.10711');
    expect(toDecimal(feeFor(fx('1000'), fx('2.5')))).to.equal('0.25');
    expect(toDecimal(feeFor(fx('1000'), fx('-1')))).to.equal('-0.1');
    expect(toDecimal(feeFor(fx('0.000001'), fx('1')))).to.equal('0.0000000001');
  });
  it('slippage moves against the taker and rounds to the tick against the taker', () => {
    expect(toDecimal(slippedPrice(fx('100'), 'buy', fx('5'), fx('0.01')))).to.equal('100.05');
    expect(toDecimal(slippedPrice(fx('100'), 'sell', fx('5'), fx('0.01')))).to.equal('99.95');
    expect(toDecimal(slippedPrice(fx('33.33'), 'buy', fx('5'), fx('0.01')))).to.equal('33.35'); // 33.346665 ↑
    expect(toDecimal(slippedPrice(fx('33.33'), 'sell', fx('5'), fx('0.01')))).to.equal('33.31'); // 33.313335 ↓
    expect(toDecimal(slippedPrice(fx('100'), 'buy', fx('0'), fx('0.5')))).to.equal('100');
    expect(toDecimal(slippedPrice(fx('100.2'), 'buy', fx('0'), fx('0.5')))).to.equal('100.5');
  });
  it('limit prices sit on the passive side; limit fills use the better of open and limit', () => {
    expect(toDecimal(limitPriceFor(fx('100'), 'buy', fx('10'), fx('0.01')))).to.equal('99.9');
    expect(toDecimal(limitPriceFor(fx('33.33'), 'sell', fx('5'), fx('0.01')))).to.equal('33.35');
    const b = { open: fx('100'), high: fx('101'), low: fx('98'), close: fx('99') };
    expect(toDecimal(limitFill(b, 'buy', fx('99')))).to.equal('99');
    expect(toDecimal(limitFill({ ...b, open: fx('97.5'), low: fx('97') }, 'buy', fx('99')))).to.equal('97.5');
    expect(limitFill(b, 'buy', fx('97.99'))).to.equal(null);
    expect(toDecimal(limitFill(b, 'sell', fx('100.5')))).to.equal('100.5');
    expect(limitFill(b, 'sell', fx('101.01'))).to.equal(null);
  });
  it('participation caps a bar to volume × pct, floored to the lot', () => {
    expect(toDecimal(participationCap(fx('7.77'), fx('10'), fx('0.1')))).to.equal('0.7');
    expect(toDecimal(participationCap(fx('0'), fx('10'), fx('0.1')))).to.equal('0');
  });
});

describe('backtest: engine semantics (hand-computed)', () => {
  it('reproduces a round trip to the last digit and labels it hypothetical', () => {
    const r = runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL()), params: BASE_PARAMS(), candles: SCENARIO });
    expect(r.signals.map((s) => [s.t - T0, s.signal])).to.deep.equal([[2 * H, 'enter'], [4 * H, 'exit']]);
    expect(r.fills.map((f) => [f.t - T0, f.side, f.qty, f.price, f.fee])).to.deep.equal([
      [2 * H, 'buy', '1', '107.11', '0.10711'],
      [4 * H, 'sell', '1', '92.9', '0.0929'],
    ]);
    expect(r.trades).to.have.length(1);
    expect(r.trades[0]).to.deep.include({ entryPrice: '107.11', exitPrice: '92.9', fees: '0.20001', pnl: '-14.41001', barsHeld: 2 });
    expect(r.metrics).to.deep.include({ finalEquity: '985.58999', netPnl: '-14.41001', feesPaid: '0.20001', slippageCost: '0.21', trades: 1, wins: 0 });
    expect(r.metrics.maxDrawdownPct.startsWith('1.518101')).to.equal(true); // (1000.78289 − 985.58999) / 1000.78289
    expect([r.label, r.mode, r.disclaimer]).to.deep.equal(['hypothetical', 'backtest', DISCLAIMER.backtest]);
    expect(r.resultHash).to.match(/^sha256:[0-9a-f]{64}$/);
    expect(runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL()), params: BASE_PARAMS(), candles: [...SCENARIO].reverse() }).resultHash).to.equal(r.resultHash);
  });

  it('limit entries rest on the passive side, fill when traded through, and pay the maker fee', () => {
    const dsl = THRESHOLD_DSL({ execution: { orderType: 'limit', limitOffsetBps: 10 } });
    const r = runBacktest({ parsed: parseStrategyDsl(dsl), params: BASE_PARAMS(), candles: SCENARIO });
    expect(r.orders[0]).to.deep.include({ type: 'limit', side: 'buy', limitPrice: '105.89' }); // 106 − 10 bps = 105.894 → tick-down
    expect(r.fills.map((f) => [f.t - T0, f.side, f.price, f.fee])).to.deep.equal([
      [3 * H, 'buy', '105.89', '0.021178'], // bar 2 low 106 misses; bar 3 low 90 trades through; maker 2 bps
      [4 * H, 'sell', '92.9', '0.0929'], // exits are always market (taker 10 bps)
    ]);
    expect(r.trades[0].pnl).to.equal('-13.104078'); // 92.9 − 105.89 − 0.021178 − 0.0929
  });

  it('latency ≥ one bar delays the fill by a bar', () => {
    const r = runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL()), params: BASE_PARAMS({ latencyMs: H }), candles: SCENARIO });
    expect(r.fills.map((f) => [f.t - T0, f.price])).to.deep.equal([[3 * H, '108.11']]);
    expect(r.metrics.rejects).to.deep.equal({ cancelled_at_end: 1 }); // the exit decided at bar 3 never reached a bar
  });

  it('partial fills follow participation and expire after maxBarsToFill', () => {
    const candles = [bar(0, '100', '101', '99', '100', '10'), bar(1, '100', '106', '99', '106', '10'), bar(2, '107', '109', '106', '108', '10'), bar(3, '108', '109', '106', '108', '10'), bar(4, '108', '109', '106', '108', '10')];
    const r = runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL()), params: BASE_PARAMS({ partialFills: { maxParticipationPct: '3', maxBarsToFill: 2 } }), candles });
    expect(r.fills.map((f) => [f.t - T0, f.qty, f.complete])).to.deep.equal([[2 * H, '0.3', false], [3 * H, '0.3', false]]);
    expect(r.metrics).to.deep.include({ partialFills: 1, fills: 2 });
    expect(r.metrics.rejects).to.deep.equal({ partially_filled_expired: 1 });
    expect(r.openPositions).to.deep.equal([{ instrument: 'BTC-USDT', side: 'long', qty: '0.6', entryPrice: '107.61', markPrice: '108' }]);
  });

  it('rejects: min quantity, min notional, cash, max positions, seeded venue rejects', () => {
    const run = (dsl, params) => runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL(dsl)), params: BASE_PARAMS(params), candles: SCENARIO }).metrics.rejects;
    // the entry condition holds on bars 1 and 2, so each rejected entry is retried once
    expect(run({ position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '0.0001' } } })).to.deep.equal({ below_min_qty: 2 });
    expect(run({}, { instruments: { 'BTC-USDT': { tickSize: '0.01', lotSize: '0.001', minQuantity: '0.001', minNotional: '500' } } })).to.deep.equal({ below_min_notional: 2 });
    expect(run({ position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '10' } } })).to.deep.equal({ insufficient_cash: 2 });
    expect(run({}, { rejectRateBps: 10_000 })).to.deep.equal({ venue_reject: 2 });
    const two = { universe: { venue: 'binance', instruments: ['BTC-USDT', 'ETH-USDT'] } };
    const both = [...SCENARIO, ...SCENARIO.map((c) => ({ ...c, instrument: 'ETH-USDT' }))];
    const params = BASE_PARAMS({ initialCash: '100000', instruments: { 'BTC-USDT': BASE_PARAMS().instruments['BTC-USDT'], 'ETH-USDT': BASE_PARAMS().instruments['BTC-USDT'] } });
    const r = runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL(two)), params, candles: both });
    expect(r.metrics.rejects).to.deep.equal({ max_positions: 2 });
    expect(r.orders[0].instrument).to.equal('BTC-USDT'); // same bar: instruments are processed in sorted order
    const seeded = (seed) => runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL()), params: BASE_PARAMS({ rejectRateBps: 5000, seed }), candles: SCENARIO }).resultHash;
    expect(seeded(7)).to.equal(seeded(7));
  });

  it('data gaps and caller-flagged stale bars suppress signals', () => {
    const gapped = [SCENARIO[0], { ...SCENARIO[1], openTime: T0 + 2 * H }, { ...SCENARIO[2], openTime: T0 + 3 * H }];
    const r = runBacktest({ parsed: parseStrategyDsl(THRESHOLD_DSL()), params: BASE_PARAMS(), candles: gapped });
    expect(r.metrics).to.deep.include({ dataGaps: 1, staleBars: 1, signals: 1 });
    expect(r.signals[0].t - T0).to.equal(4 * H); // the gap bar (close 106) is suppressed; the next bar signals
    const parsed = parseStrategyDsl(THRESHOLD_DSL());
    const sim = defineSimParams(BASE_PARAMS(), parsed.definition);
    const e = new SimulationEngine({ compiled: compileStrategy(parsed), definition: parsed.definition, params: sim.params, mode: 'paper' });
    SCENARIO.forEach((c) => e.ingest(c, { stale: true }));
    expect(e.finish().metrics).to.deep.include({ staleBars: 5, signals: 0 });
  });

  it('refuses out-of-order, overlapping, malformed and foreign candles without touching state', () => {
    const parsed = parseStrategyDsl(THRESHOLD_DSL());
    const sim = defineSimParams(BASE_PARAMS(), parsed.definition);
    const e = new SimulationEngine({ compiled: compileStrategy(parsed), definition: parsed.definition, params: sim.params, mode: 'backtest' });
    e.ingest(SCENARIO[1]);
    for (const bad of [SCENARIO[0], { ...SCENARIO[2], openTime: T0 + H + 1 }, { ...SCENARIO[2], close: 107 }, { ...SCENARIO[2], high: '1' }, { ...SCENARIO[2], instrument: 'ETH-USDT' }]) {
      expect(() => e.ingest(bad)).to.throw(SimError).with.property('code', 'INPUT_INVALID');
    }
    e.ingest(SCENARIO[2]);
    expect(e.finish().metrics).to.deep.include({ bars: 2, dataGaps: 0 });
    expect(() => prepareHistory([{ ...SCENARIO[0], closed: false }], ['BTC-USDT'])).to.throw(/unclosed/);
    expect(() => prepareHistory([SCENARIO[0], SCENARIO[0]], ['BTC-USDT'])).to.throw(/duplicate/);
  });

  it('params are validated, bounded and hashed; currency and filters must match the strategy', () => {
    const def = parseStrategyDsl(THRESHOLD_DSL()).definition;
    expect(defineSimParams(BASE_PARAMS(), def).hash).to.equal(defineSimParams({ ...BASE_PARAMS(), slippageBps: '10.00' }, def).hash);
    for (const over of [{ initialCash: 1000 }, { slippageBps: '1001' }, { leverage: 5 }, { windowBars: 10 }, { instruments: {} }]) {
      expect(() => defineSimParams(BASE_PARAMS(over), def), JSON.stringify(over)).to.throw(SimError).with.property('code', 'CONFIG');
    }
    expect(() => defineSimParams(BASE_PARAMS({ instruments: { 'ETH-USDT': BASE_PARAMS().instruments['BTC-USDT'] } }), def)).to.throw(/no instrument filters/);
    const notional = parseStrategyDsl(THRESHOLD_DSL({ position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '100', currency: 'INR' } } })).definition;
    expect(() => defineSimParams(BASE_PARAMS(), notional)).to.throw(/sizes in INR/);
  });
});

describe('backtest: market hours', () => {
  it('crypto venues are always open', () => {
    expect(marketCalendar('binance').isOpen(Date.UTC(2026, 9, 3, 3))).to.equal(true); // Saturday
  });
  it('NSE (upstox): Mon–Fri 09:15–15:30 IST, holidays closed', () => {
    const nse = marketCalendar('upstox', ['2026-10-06']);
    const at = (d, h, m) => nse.isOpen(Date.UTC(2026, 9, d, h, m));
    expect([at(5, 3, 44), at(5, 3, 45), at(5, 9, 59), at(5, 10, 0)]).to.deep.equal([false, true, true, false]); // Mon 09:14 / 09:15 / 15:29 / 15:30 IST
    expect(at(3, 6, 0)).to.equal(false); // Saturday
    expect(at(6, 6, 0)).to.equal(false); // holiday
  });
  it('NYSE (alpaca): 09:30–16:00 America/New_York across DST', () => {
    const ny = marketCalendar('alpaca');
    expect([ny.isOpen(Date.UTC(2026, 6, 6, 13, 29)), ny.isOpen(Date.UTC(2026, 6, 6, 13, 30))]).to.deep.equal([false, true]); // EDT
    expect([ny.isOpen(Date.UTC(2026, 0, 5, 13, 30)), ny.isOpen(Date.UTC(2026, 0, 5, 14, 30)), ny.isOpen(Date.UTC(2026, 0, 5, 21, 0))]).to.deep.equal([false, true, false]); // EST
  });
  it('orders arriving outside the session are rejected market_closed', () => {
    const dsl = THRESHOLD_DSL({ universe: { venue: 'alpaca', instruments: ['NASDAQ:AAPL'] } });
    const params = BASE_PARAMS({ instruments: { 'NASDAQ:AAPL': BASE_PARAMS().instruments['BTC-USDT'] }, quoteCurrency: 'USD' });
    const r = runBacktest({ parsed: parseStrategyDsl(dsl), params, candles: SCENARIO.map((c) => ({ ...c, instrument: 'NASDAQ:AAPL' })) }); // 00:00–05:00Z = night in New York
    expect(r.metrics.rejects).to.deep.equal({ market_closed: 2 });
    expect(r.fills).to.have.length(0);
  });
});

// ── Parity ──────────────────────────────────────────────────────────────────────

function fixture({ bars = 600, instruments = ['BTC-USDT', 'ETH-USDT'], drop = [] } = {}) {
  const out = [];
  instruments.forEach((id, k) => {
    let seed = 1400 + k;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let p = k === 0 ? 30_000 : 2_000;
    for (let i = 0; i < bars; i += 1) {
      const o = p;
      p = Math.max(1, p * (1 + (rnd() - 0.5) * 0.03 + 0.012 * Math.sin(i / 23 + k)));
      const hi = Math.max(o, p) * (1 + rnd() * 0.006);
      const lo = Math.min(o, p) * (1 - rnd() * 0.006);
      if (drop.includes(`${id}@${i}`)) continue;
      out.push({ instrument: id, openTime: T0 + i * H, open: o.toFixed(2), high: hi.toFixed(2), low: lo.toFixed(2), close: p.toFixed(2), volume: (2 + rnd() * 6).toFixed(3) });
    }
  });
  return out;
}
const PARITY_DSL = (over = {}) => ({
  dsl: 'satelink.strategy/1.0', name: 'Parity', universe: { venue: 'binance', instruments: ['BTC-USDT', 'ETH-USDT'] }, timeframe: '1h',
  indicators: { fast: { type: 'ema', period: 8 }, slow: { type: 'sma', period: 21 }, rsi: { type: 'rsi', period: 14 } },
  entry: { all: [{ cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } }, { cmp: { op: 'lt', left: { ind: 'rsi' }, right: { const: '75' } } }] },
  exit: { any: [{ cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } }, { cmp: { op: 'gt', left: { ind: 'rsi' }, right: { const: '85' } } }] },
  position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '5000', currency: 'USDT' }, maxOpenPositions: 2 },
  risk: { stopLossPct: '2', takeProfitPct: '4', maxHoldingBars: 48 },
  execution: { cooldownBars: 2 },
  ...over,
});
const PARITY_PARAMS = (over = {}) => ({
  params: 'satelink.sim-params/1.0', initialCash: '20000', quoteCurrency: 'USDT',
  instruments: {
    'BTC-USDT': { tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5' },
    'ETH-USDT': { tickSize: '0.01', lotSize: '0.001', minQuantity: '0.001', minNotional: '5' },
  },
  windowBars: 120,
  ...over,
});

/** A live-like feed: last `limit` closed bars + the forming bar, overlapping polls, ETH lagging every 3rd poll. */
function replayFeed(candles) {
  const byInst = new Map();
  for (const c of candles) { if (!byInst.has(c.instrument)) byInst.set(c.instrument, []); byInst.get(c.instrument).push(c); }
  let now = T0;
  const calls = [];
  const feed = {
    setNow(t) { now = t; },
    async getCandles(principalId, instrument, interval, { purpose, limit }) {
      calls.push({ principalId, instrument, interval, purpose });
      const closed = byInst.get(instrument).filter((c) => c.openTime + H <= now);
      const lag = instrument === 'ETH-USDT' && Math.floor(now / H) % 3 === 0 ? 1 : 0;
      const visible = closed.slice(0, closed.length - lag).slice(-limit);
      const forming = byInst.get(instrument).find((c) => c.openTime + H > now);
      const iso = (c, isClosed) => ({ kind: 'candle', venue: 'binance', instrument: c.instrument, interval, openTime: new Date(c.openTime).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, closed: isClosed });
      return { data: [...visible.map((c) => iso(c, true)), ...(forming ? [iso(forming, false)] : [])].reverse() };
    },
    calls,
  };
  return feed;
}

async function paperReplay({ dsl, params, candles, staleAfterMs = 3 * H }) {
  const feed = replayFeed(candles);
  const parsed = parseStrategyDsl(dsl);
  const runner = new PaperRunner({ parsed, params, clock: () => new Date(feedNow), staleAfterMs });
  const end = Math.max(...candles.map((c) => c.openTime)) + 2 * H;
  let feedNow = T0;
  for (let t = T0 + H; t <= end + 3 * H; t += H) {
    feedNow = t + 1000;
    feed.setNow(t);
    await runner.pump(feed, 'prn_paper', { limit: 5 });
  }
  return { result: runner.stop(), runner, feed };
}

describe('parity: backtest vs paper on replayed fixture data (acceptance: 100%)', function () {
  this.timeout(60_000);
  const variants = {
    'market orders, default fill model': [PARITY_DSL(), PARITY_PARAMS()],
    'limit orders, latency > 1 bar, venue rejects, tight partial fills': [
      PARITY_DSL({ execution: { orderType: 'limit', limitOffsetBps: 10, cooldownBars: 1 } }),
      PARITY_PARAMS({ latencyMs: 90 * 60_000, rejectRateBps: 800, seed: 99, partialFills: { maxParticipationPct: '15', maxBarsToFill: 2 } }),
    ],
    'short side with data gaps': [
      PARITY_DSL({ position: { side: 'short', sizing: { mode: 'fixed_notional', notional: '3000', currency: 'USDT' }, maxOpenPositions: 1 } }),
      PARITY_PARAMS({ fees: { takerBps: '7.5', makerBps: '-1' }, slippageBps: '3' }),
      { drop: ['ETH-USDT@100', 'ETH-USDT@101', 'BTC-USDT@350'] },
    ],
  };
  for (const [name, [dsl, params, fx_]] of Object.entries(variants)) {
    it(`${name}: identical signals, orders, fills, trades, rejects and metrics`, async () => {
      const candles = fixture(fx_);
      const bt = runBacktest({ parsed: parseStrategyDsl(dsl), params, candles });
      const { result: pp, runner, feed } = await paperReplay({ dsl, params, candles });
      expect(bt.signals.length, 'fixture must exercise the strategy').to.be.greaterThan(10);
      expect(bt.fills.length).to.be.greaterThan(5);
      expect(parityView(pp)).to.deep.equal(parityView(bt));
      expect([bt.label, pp.label]).to.deep.equal(['hypothetical', 'simulated']);
      expect(pp.disclaimer).to.equal(DISCLAIMER.paper);
      const st = runner.stats();
      expect(st.duplicates, 'polls overlapped').to.be.greaterThan(0);
      expect(st.unclosed, 'forming bars were ignored').to.be.greaterThan(0);
      expect([st.released, st.late, st.stale]).to.deep.equal([candles.length, 0, 0]);
      expect(new Set(feed.calls.map((c) => c.purpose))).to.deep.equal(new Set(['internal_use']));
    });
  }

  it('a strict wall-clock staleness threshold diverges from the backtest (stale bars produce no signals)', async () => {
    const candles = fixture();
    const { result, runner } = await paperReplay({ dsl: PARITY_DSL(), params: PARITY_PARAMS(), candles, staleAfterMs: 1 });
    expect(runner.stats().stale).to.equal(candles.length);
    expect(result.metrics.signals).to.equal(0);
  });

  it('backtests are deterministic (same inputs → same resultHash)', () => {
    const candles = fixture();
    const a = runBacktest({ parsed: parseStrategyDsl(PARITY_DSL()), params: PARITY_PARAMS(), candles });
    const b = runBacktest({ parsed: parseStrategyDsl(PARITY_DSL()), params: PARITY_PARAMS(), candles: [...candles].reverse() });
    expect(b.resultHash).to.equal(a.resultHash);
    expect(b.dataHash).to.equal(a.dataHash);
  });
});

describe('backtest job + lifecycle evidence', function () {
  this.timeout(60_000);
  const alice = { principalId: 'prn_alice', kind: 'human' };
  async function setup(history) {
    let n = 0;
    const strategies = new StrategyService({ store: new InMemoryStrategyStore(), idFactory: (p) => `${p}_${++n}`, env: { [tradingFlagEnvName('TRADING_AGENT')]: 'true' } });
    const s = await strategies.createStrategy({ actor: alice, name: 'Parity' });
    const v = await strategies.createVersion({ actor: alice, strategyId: s.id, dsl: PARITY_DSL() });
    const store = new InMemoryBacktestStore();
    let clock = T0;
    const jobs = new BacktestJobService({ store, strategies, history, clock: () => new Date(clock += 1000) });
    return { strategies, v, store, jobs };
  }

  it('enqueue → runOnce → completed hypothetical result → evidence moves DRAFT → BACKTESTED', async () => {
    const candles = fixture();
    const requests = [];
    const { strategies, v, store, jobs } = await setup({ async getCandles(q) { requests.push(q); return candles; } });
    const { id } = await jobs.enqueue({ principalId: 'prn_alice', strategyVersionId: v.id, fromMs: T0, toMs: T0 + 600 * H, params: PARITY_PARAMS() });
    expect(id).to.match(/^bkt_[0-9a-f]{24}$/);
    const done = await jobs.runOnce();
    expect(done).to.deep.include({ id, status: 'completed' });
    expect(await jobs.runOnce()).to.equal(null);
    expect(requests[0]).to.deep.equal({ venue: 'binance', instruments: ['BTC-USDT', 'ETH-USDT'], timeframe: '1h', fromMs: T0, toMs: T0 + 600 * H });
    const row = await store.get(id);
    expect(row).to.deep.include({ status: 'completed', label: 'hypothetical', bars: 1200, attempts: 1 });
    expect(row.result.resultHash).to.equal(row.resultHash);
    expect(row.result).to.deep.include({ label: 'hypothetical', backtestId: id });
    const ev = backtestEvidence(row);
    expect(ev).to.deep.equal({ backtestId: id, definitionHash: v.definitionHash, bars: 1200, passed: row.passed });
    expect(row.passed).to.equal(true);
    const moved = await strategies.transition({ actor: alice, versionId: v.id, to: LS.BACKTESTED, expectedFrom: LS.DRAFT, evidence: { backtest: ev } });
    expect(moved.to).to.equal(LS.BACKTESTED);
  });

  it('failures are recorded, never retried silently: bad data, out-of-window data, port errors', async () => {
    const candles = fixture();
    for (const [history, code] of [
      [{ async getCandles() { return []; } }, 'DATA_INVALID'],
      [{ async getCandles() { return candles; } }, 'DATA_INVALID'], // window ends before the data does
      [{ async getCandles() { throw new Error('upstream down'); } }, 'ERROR'],
    ]) {
      const { v, store, jobs } = await setup(history);
      const { id } = await jobs.enqueue({ principalId: 'prn_alice', strategyVersionId: v.id, fromMs: T0, toMs: T0 + 100 * H, params: PARITY_PARAMS() });
      expect(await jobs.runOnce()).to.deep.include({ id, status: 'failed', error: code });
      expect((await store.get(id)).error).to.match(new RegExp(`^${code}`));
    }
    const { v, jobs } = await setup({ async getCandles() { return candles; } });
    expect(await codeOf(jobs.enqueue({ principalId: 'prn_alice', strategyVersionId: v.id, fromMs: T0, toMs: T0, params: PARITY_PARAMS() }))).to.equal('CONFIG');
    expect(await codeOf(jobs.enqueue({ principalId: 'prn_alice', strategyVersionId: v.id, fromMs: T0, toMs: T0 + H, params: { ...PARITY_PARAMS(), seed: -1 } }))).to.equal('CONFIG');
  });

  it('paper runs persist as simulated rows and produce PAPER → LIVE_SMALL evidence (still blocked by the LIVE_TRADING lock)', async () => {
    const candles = fixture();
    const parsed = parseStrategyDsl(PARITY_DSL());
    const store = new InMemoryBacktestStore();
    const runner = new PaperRunner({ parsed, params: PARITY_PARAMS(), clock: () => new Date(T0 + 700 * H), staleAfterMs: 1000 * H });
    const { id } = await startPaperRun({ store, runner, principalId: 'prn_alice', strategyVersionId: 'stv_1', definitionHash: parsed.hash, clock: () => new Date(T0) });
    expect(id).to.match(/^ppr_[0-9a-f]{24}$/);
    runner.ingest(candles);
    const result = await stopPaperRun({ store, runner, id, clock: () => new Date(T0 + 701 * H) });
    const row = await store.get(id);
    expect(row).to.deep.include({ status: 'completed', label: 'simulated', mode: 'paper' });
    expect(result.label).to.equal('simulated');
    const ev = paperEvidence(row);
    expect(ev).to.deep.equal({ paperRunId: id, definitionHash: parsed.hash, days: 25, trades: result.metrics.trades });
    let err;
    try {
      checkTransition({ from: LS.PAPER, to: LS.LIVE_SMALL, actor: { principalId: 'prn_alice', kind: 'human' }, evidence: { approval: { approvedBy: 'prn_alice', note: 'x' }, paper: ev, mandateId: 'mdt_1' }, definitionHash: parsed.hash, env: { [tradingFlagEnvName('TRADING_AGENT')]: 'true', [tradingFlagEnvName('LIVE_SMALL')]: 'true', [tradingFlagEnvName('LIVE_TRADING')]: 'true' } });
    } catch (e) { err = e; }
    expect(err.details.failures.filter((f) => f.startsWith('evidence'))).to.deep.equal([]);
    expect(err.details.failures).to.include('flag LIVE_TRADING is not enabled (LOCKED)');
  });
});

describe('backtest/paper isolation (static)', () => {
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const SRC = [...files(path.join(TA, 'backtest')), ...files(path.join(TA, 'paper'))].filter((f) => f.endsWith('.mjs'));

  it('never reaches a broker, credentials, the real book, the ledger, Redis/queues or process.env', () => {
    for (const f of SRC) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) {
        expect(s, `${path.basename(f)} imports ${s}`).to.not.match(/brokers\/(adapter|mock_broker|index)|credentials|execution|\/orders|\/positions|\/outbox|ledger|billing|settlement|^(pg|ioredis|redis|bullmq|node:child_process|node:fs|node:net|node:http|node:https)$/);
      }
      expect(src, path.basename(f)).to.not.match(/process\.env|fetch\(/);
      expect(src, path.basename(f)).to.not.match(/INSERT INTO (orders|fills|positions|order_events|ledger|journal)/i);
    }
  });

  it('contains no vectorbt or copyleft-licensed code', () => {
    for (const f of SRC) expect(fs.readFileSync(f, 'utf8'), path.basename(f)).to.not.match(/vectorbt|GNU (Affero )?General Public License|SPDX-License-Identifier:\s*A?GPL/i);
  });
});
