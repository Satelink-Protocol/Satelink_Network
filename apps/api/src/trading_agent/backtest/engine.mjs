// Event-driven simulation engine shared by the backtester and the paper runner (Stage 14).
//
// One engine, two drivers: backtest replays stored candles; paper feeds live closed
// candles. Both call ingest() in the same (openTime, instrument) order, so the same
// data gives the same signals, orders and fills (parity). The engine only ever touches
// its own SIMULATED book (cash + positions in memory). It never writes orders, fills,
// positions or the ledger, and it never talks to a broker.
//
// Per candle, in order:
//   1. fill   pending order of that instrument, if it has arrived (decision time + latency)
//             market → bar open moved by slippage; limit → if the bar trades through it;
//             capped by participation % of bar volume (partial fills); expires after N bars
//   2. book   append to the evaluator window, mark-to-market, age the position
//   3. signal unless the bar is stale (data gap or caller-flagged): the Stage 13 evaluator
//             at bar close → order through market hours, sizing, exchange filters, cash,
//             max positions and seeded venue rejects
//   4. equity peak / drawdown
//
// Model limits (documented in docs/trading-agent/stages/14-backtest-paper.md): intrabar
// path unknown (fills use the bar open); no margin model (entries need 1× cash collateral);
// exits are market orders and skip min-size filters; no funding, borrow or interest.
import { SimError } from './errors.mjs';
import { marketCalendar } from './calendar.mjs';
import { floorToStep, feeFor, slippedPrice, limitPriceFor, participationCap, limitFill, pctOf, fx } from './fill_model.mjs';
import { toDecimal, mul, div } from '../strategies/fixed.mjs';
import { INTERVAL_MS } from '../market_data/types.mjs';

export const ENGINE_VERSION = 'sim-1.0';
export const SimMode = Object.freeze({ BACKTEST: 'backtest', PAPER: 'paper' });
export const ResultLabel = Object.freeze({ backtest: 'hypothetical', paper: 'simulated' });
export const DISCLAIMER = Object.freeze({
  backtest: 'HYPOTHETICAL RESULTS: simulated on historical data with modelled fees, slippage, latency and fills. Not actual trading; no orders were placed and no funds moved. Simulated performance does not indicate future results.',
  paper: 'SIMULATED RESULTS: paper trading against a simulated book on market data. No real orders were placed and no funds moved. Simulated performance does not indicate future results.',
});
const MAX_EVENTS = 50_000;

export class SimulationEngine {
  #c; #def; #p; #mode; #interval; #cal; #rng;
  #cash; #inst = new Map(); #lastKey = null;
  #seq = 0; #peak; #maxDd = 0n; #first = null; #lastClose = null;
  #log = { signals: [], orders: [], fills: [], trades: [], rejects: [] };
  #n = { bars: 0, staleBars: 0, gaps: 0, holds: 0, partialFills: 0, exposureBars: 0, slippage: 0n, fees: 0n };
  #truncated = false;
  #finished = null;

  /**
   * @param {{compiled, definition, params, mode}} o
   *   compiled: compileStrategy() result; definition: the normalised strategy definition;
   *   params: defineSimParams().params; mode: 'backtest' | 'paper'.
   */
  constructor({ compiled, definition, params, mode }) {
    if (!compiled || typeof compiled.evaluate !== 'function' || !definition || !params) throw new SimError('CONFIG', 'engine needs compiled, definition and params');
    if (!Object.values(SimMode).includes(mode)) throw new SimError('CONFIG', `unknown mode ${mode}`);
    if (compiled.hash === undefined || compiled.timeframe !== definition.timeframe) throw new SimError('CONFIG', 'compiled strategy does not match its definition');
    if (params.windowBars < compiled.warmupBars) throw new SimError('CONFIG', `windowBars ${params.windowBars} < strategy warm-up ${compiled.warmupBars}`);
    this.#c = compiled;
    this.#def = definition;
    this.#p = params;
    this.#mode = mode;
    this.#interval = INTERVAL_MS[definition.timeframe];
    this.#cal = marketCalendar(definition.universe.venue, params.holidays);
    this.#rng = mulberry32(params.seed);
    this.#cash = fx(params.initialCash);
    this.#peak = this.#cash;
    for (const id of definition.universe.instruments) {
      const f = params.instruments[id];
      if (!f) throw new SimError('CONFIG', `no filters for ${id}`);
      this.#inst.set(id, {
        id,
        tick: fx(f.tickSize), lot: fx(f.lotSize), minQty: fx(f.minQuantity), minNotional: fx(f.minNotional),
        history: [], lastOpen: null, lastClose: null, position: null, pending: null, sinceExit: null,
      });
    }
  }

  get mode() { return this.#mode; }

  /**
   * Feed one closed candle. `stale: true` (paper: wall-clock staleness) suppresses the
   * signal step for this bar, exactly like a data gap does.
   */
  ingest(candle, { stale = false } = {}) {
    if (this.#finished) throw new SimError('CONFLICT', 'engine already finished');
    const s = this.#inst.get(candle?.instrument);
    if (!s) throw new SimError('INPUT_INVALID', `instrument ${candle?.instrument} is not in the strategy universe`);
    const t = candle.openTime;
    if (!Number.isSafeInteger(t)) throw new SimError('INPUT_INVALID', 'openTime must be integer ms');
    const key = [t, s.id];
    if (this.#lastKey && (t < this.#lastKey[0] || (t === this.#lastKey[0] && s.id <= this.#lastKey[1]))) {
      throw new SimError('INPUT_INVALID', `candle ${s.id}@${t} is out of order (must follow ${this.#lastKey[1]}@${this.#lastKey[0]})`);
    }
    let gap = false;
    if (s.lastOpen !== null) {
      const step = t - s.lastOpen;
      if (step < this.#interval) throw new SimError('INPUT_INVALID', `candle ${s.id}@${t} overlaps the previous bar`);
      gap = step > this.#interval;
    }
    const bar = readBar(candle); // validate before any state changes: a rejected candle leaves no trace
    if (gap) this.#n.gaps += 1;
    this.#lastKey = key;
    if (this.#first === null) this.#first = t;
    const closeTime = t + this.#interval;
    this.#lastClose = Math.max(this.#lastClose ?? 0, closeTime);

    // 1. fills
    if (s.pending) this.#tryFill(s, bar, t, closeTime);

    // 2. book
    s.history.push({ openTime: t, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    if (s.history.length > this.#p.windowBars) s.history.shift();
    s.lastOpen = t;
    s.lastClose = bar.close;
    if (s.position) { s.position.barsHeld += 1; this.#n.exposureBars += 1; }
    if (s.sinceExit !== null) s.sinceExit += 1;
    this.#n.bars += 1;

    // 3. signal
    if (stale || gap) this.#n.staleBars += 1;
    else if (!s.pending) {
      const p = s.position;
      const r = this.#c.evaluate({
        candles: s.history,
        position: p ? { side: p.side, entryPrice: toDecimal(div(p.cost, p.qty)), barsHeld: p.barsHeld } : null,
        barsSinceLastExit: s.sinceExit,
      });
      if (r.ready && r.signal !== 'hold') {
        this.#push('signals', { t: closeTime, instrument: s.id, signal: r.signal, reasons: [...r.reasons] });
        this.#submit(s, r.signal, closeTime);
      } else if (r.ready) this.#n.holds += 1;
    }

    // 4. equity
    const eq = this.#equity();
    if (eq > this.#peak) this.#peak = eq;
    else if (this.#peak > 0n) {
      const dd = pctOf(this.#peak - eq, this.#peak);
      if (dd > this.#maxDd) this.#maxDd = dd;
    }
  }

  #submit(s, signal, decisionTime) {
    const entry = signal === 'enter';
    const long = this.#def.position.side === 'long';
    const side = entry === long ? 'buy' : 'sell';
    const type = entry ? this.#def.execution.orderType : 'market';
    const arrival = decisionTime + this.#p.latencyMs;
    const reject = (reason) => this.#push('rejects', { t: decisionTime, instrument: s.id, purpose: entry ? 'entry' : 'exit', reason });

    if (!this.#cal.isOpen(arrival)) return reject('market_closed');
    let qty;
    let limitPrice = null;
    const ref = s.lastClose;
    if (entry) {
      const open = [...this.#inst.values()].filter((x) => x.position || x.pending?.purpose === 'entry').length;
      if (open >= this.#def.position.maxOpenPositions) return reject('max_positions');
      const sizing = this.#def.position.sizing;
      qty = floorToStep(sizing.mode === 'fixed_quantity' ? fx(sizing.quantity) : div(fx(sizing.notional), ref), s.lot);
      if (qty <= 0n || qty < s.minQty) return reject('below_min_qty');
      const notional = mul(qty, ref);
      if (notional < s.minNotional) return reject('below_min_notional');
      const est = mul(qty, slippedPrice(ref, 'buy', fx(this.#p.slippageBps), s.tick));
      if (est + feeFor(est, fx(this.#p.fees.takerBps)) > this.#cash) return reject('insufficient_cash'); // 1× collateral, both sides
      if (type === 'limit') limitPrice = limitPriceFor(ref, side, fx(String(this.#def.execution.limitOffsetBps)), s.tick);
    } else {
      qty = s.position.qty;
    }
    if (this.#p.rejectRateBps > 0 && Math.floor(this.#rng() * 10_000) < this.#p.rejectRateBps) return reject('venue_reject');
    const id = ++this.#seq;
    s.pending = { id, purpose: entry ? 'entry' : 'exit', side, type, qty, filled: 0n, limitPrice, arrival, waited: 0 };
    this.#push('orders', { id, t: decisionTime, arrival, instrument: s.id, purpose: s.pending.purpose, side, type, qty: toDecimal(qty), limitPrice: limitPrice === null ? null : toDecimal(limitPrice) });
  }

  #tryFill(s, bar, openTime, closeTime) {
    const o = s.pending;
    if (o.arrival >= closeTime) return; // not arrived during this bar
    o.waited += 1;
    const price = o.type === 'market'
      ? slippedPrice(bar.open, o.side, fx(this.#p.slippageBps), s.tick)
      : limitFill(bar, o.side, o.limitPrice);
    const cap = participationCap(bar.volume, fx(this.#p.partialFills.maxParticipationPct), s.lot);
    let qty = o.qty - o.filled;
    if (cap < qty) qty = cap;
    if (price !== null && qty > 0n) {
      const notional = mul(qty, price);
      const fee = feeFor(notional, fx(o.type === 'market' ? this.#p.fees.takerBps : this.#p.fees.makerBps));
      if (o.purpose === 'entry' && o.side === 'buy' && notional + fee > this.#cash) {
        this.#push('rejects', { t: openTime, instrument: s.id, purpose: 'entry', reason: 'insufficient_cash' });
        s.pending = null;
        return;
      }
      this.#cash += o.side === 'buy' ? -(notional + fee) : notional - fee;
      this.#n.fees += fee;
      if (o.type === 'market') this.#n.slippage += mul(price > bar.open ? price - bar.open : bar.open - price, qty);
      o.filled += qty;
      this.#push('fills', { orderId: o.id, t: openTime, instrument: s.id, purpose: o.purpose, side: o.side, qty: toDecimal(qty), price: toDecimal(price), fee: toDecimal(fee), complete: o.filled === o.qty });
      this.#applyFill(s, o, qty, price, notional, fee, openTime);
    }
    if (o.filled === o.qty) s.pending = null;
    else if (o.waited >= this.#p.partialFills.maxBarsToFill) {
      if (o.filled > 0n) this.#n.partialFills += 1;
      this.#push('rejects', { t: closeTime, instrument: s.id, purpose: o.purpose, reason: o.filled > 0n ? 'partially_filled_expired' : 'expired_unfilled' });
      s.pending = null;
    }
  }

  #applyFill(s, o, qty, price, notional, fee, t) {
    if (o.purpose === 'entry') {
      if (!s.position) s.position = { side: this.#def.position.side, qty: 0n, cost: 0n, entryFees: 0n, entryTime: t, barsHeld: 0, exitValue: 0n, exitFees: 0n, closedQty: 0n, closedCost: 0n };
      s.position.qty += qty;
      s.position.cost += notional;
      s.position.entryFees += fee;
      return;
    }
    const p = s.position;
    const avg = div(p.cost, p.qty);
    const costOut = mul(avg, qty);
    p.closedCost += costOut;
    p.cost -= costOut;
    p.qty -= qty;
    p.closedQty += qty;
    p.exitValue += notional;
    p.exitFees += fee;
    if (p.qty === 0n) {
      const gross = p.side === 'long' ? p.exitValue - p.closedCost : p.closedCost - p.exitValue;
      const pnl = gross - p.entryFees - p.exitFees;
      this.#push('trades', {
        instrument: s.id, side: p.side, entryTime: p.entryTime, exitTime: t, barsHeld: p.barsHeld, qty: toDecimal(p.closedQty),
        entryPrice: toDecimal(div(p.closedCost, p.closedQty)), exitPrice: toDecimal(div(p.exitValue, p.closedQty)),
        fees: toDecimal(p.entryFees + p.exitFees), pnl: toDecimal(pnl),
      });
      s.position = null;
      s.sinceExit = 0;
    }
  }

  #equity() {
    let eq = this.#cash;
    for (const s of this.#inst.values()) {
      if (!s.position) continue;
      const v = mul(s.position.qty, s.lastClose);
      eq += s.position.side === 'long' ? v : -v;
    }
    return eq;
  }

  #push(kind, item) {
    const total = Object.values(this.#log).reduce((a, l) => a + l.length, 0);
    if (total >= MAX_EVENTS) { this.#truncated = true; return; }
    this.#log[kind].push(item);
  }

  /**
   * Stop the simulation: cancel pending orders, mark open positions to market, and
   * return the labelled result (no hashes; see result.mjs). Idempotent.
   */
  finish() {
    if (this.#finished) return this.#finished;
    for (const s of this.#inst.values()) {
      if (s.pending) this.#push('rejects', { t: this.#lastClose, instrument: s.id, purpose: s.pending.purpose, reason: 'cancelled_at_end' });
      s.pending = null;
    }
    const initial = fx(this.#p.initialCash);
    const finalEquity = this.#equity();
    const trades = this.#log.trades;
    const wins = trades.filter((x) => fx(x.pnl) > 0n).length;
    const rejectsByReason = {};
    for (const r of this.#log.rejects) rejectsByReason[r.reason] = (rejectsByReason[r.reason] ?? 0) + 1;
    const metrics = {
      initialCash: toDecimal(initial),
      finalEquity: toDecimal(finalEquity),
      netPnl: toDecimal(finalEquity - initial),
      returnPct: toDecimal(pctOf(finalEquity - initial, initial)),
      maxDrawdownPct: toDecimal(this.#maxDd),
      feesPaid: toDecimal(this.#n.fees),
      slippageCost: toDecimal(this.#n.slippage),
      trades: trades.length,
      wins,
      winRatePct: toDecimal(pctOf(BigInt(wins) * 10n ** 18n, BigInt(Math.max(trades.length, 1)) * 10n ** 18n)),
      bars: this.#n.bars,
      staleBars: this.#n.staleBars,
      dataGaps: this.#n.gaps,
      exposureBars: this.#n.exposureBars,
      signals: this.#log.signals.length,
      orders: this.#log.orders.length,
      fills: this.#log.fills.length,
      partialFills: this.#n.partialFills,
      rejects: rejectsByReason,
    };
    const crit = this.#p.passCriteria;
    const passed = trades.length >= crit.minTrades && this.#maxDd <= fx(crit.maxDrawdownPct);
    const openPositions = [...this.#inst.values()].filter((s) => s.position).map((s) => ({
      instrument: s.id, side: s.position.side, qty: toDecimal(s.position.qty),
      entryPrice: toDecimal(div(s.position.cost, s.position.qty)), markPrice: toDecimal(s.lastClose),
    }));
    this.#finished = Object.freeze({
      label: ResultLabel[this.#mode],
      disclaimer: DISCLAIMER[this.#mode],
      mode: this.#mode,
      engineVersion: ENGINE_VERSION,
      definitionHash: this.#c.hash,
      period: { firstOpenTime: this.#first, lastCloseTime: this.#lastClose },
      metrics,
      passed,
      truncated: this.#truncated,
      openPositions,
      ...structuredClone(this.#log),
    });
    return this.#finished;
  }
}

function readBar(c) {
  let bar;
  try {
    bar = { open: fx(c.open), high: fx(c.high), low: fx(c.low), close: fx(c.close), volume: fx(c.volume ?? '0') };
  } catch (e) {
    throw new SimError('INPUT_INVALID', `candle ${c.instrument}@${c.openTime}: ${e.message}`);
  }
  if (bar.high < bar.low || bar.high < bar.open || bar.high < bar.close || bar.low > bar.open || bar.low > bar.close || bar.low < 0n || bar.volume < 0n) {
    throw new SimError('INPUT_INVALID', `candle ${c.instrument}@${c.openTime}: inconsistent OHLCV`);
  }
  return bar;
}

/** Seeded PRNG (mulberry32): venue rejects are reproducible from params.seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
