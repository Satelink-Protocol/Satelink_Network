// Compile a parsed strategy definition into a pure evaluator (Stage 13).
//
// compileStrategy(parsed) → frozen { hash, dslVersion, timeframe, instruments,
// warmupBars, position, risk, execution, evaluate }. `evaluate(input)` is a pure
// function of (definition, input): no I/O, clock, randomness or shared state,
// and it never places, sizes or routes an order. It returns a signal
// ('enter' | 'exit' | 'hold') with reasons. Acting on a signal belongs to the
// risk/mandate/execution stages, behind their own flags and guards.
import { StrategyError } from './errors.mjs';
import { HASH_RE, canonicalJson, contentHash, deepFreeze } from './canonical.mjs';
import { fx, toDecimal, add, sub, mul, div, fxInt } from './fixed.mjs';
import { computeIndicator, warmupOf } from './indicators.mjs';
import { PRICE_SOURCES } from './dsl_schema_v1.mjs';

const HUNDRED = fxInt(100);
const MAX_BARS = 10_000;

export function compileStrategy(parsed) {
  if (!parsed || !HASH_RE.test(parsed.hash ?? '') || !parsed.definition) {
    throw new StrategyError('CONFIG', 'compileStrategy expects the result of parseStrategyDsl');
  }
  if (contentHash(canonicalJson(parsed.definition)) !== parsed.hash) {
    throw new StrategyError('CONFIG', 'definition does not match its hash (tampered or not normalised)');
  }
  const def = parsed.definition;
  const indicatorIds = Object.keys(def.indicators).sort();
  const warmupBars = Math.max(1, ...indicatorIds.map((id) => warmupOf(def.indicators[id]))) + 1; // +1: crossings need the previous bar
  const stopLoss = fx(def.risk.stopLossPct);
  const takeProfit = def.risk.takeProfitPct === undefined ? null : fx(def.risk.takeProfitPct);

  function evaluate(input) {
    const { candles, position = null, barsSinceLastExit = null } = input ?? {};
    const bars = readBars(candles);
    if (position !== null) readPosition(position, def.position.side);
    if (barsSinceLastExit !== null && !(Number.isSafeInteger(barsSinceLastExit) && barsSinceLastExit >= 0)) {
      throw new StrategyError('INPUT_INVALID', 'barsSinceLastExit must be a non-negative integer or null');
    }
    if (bars.length < warmupBars) {
      return deepFreeze({ ready: false, needBars: warmupBars, signal: 'hold', reasons: ['warming_up'], values: {} });
    }
    const series = {};
    for (const id of indicatorIds) series[id] = computeIndicator(def.indicators[id], bars);
    const last = bars.length - 1;
    const value = (o, i) => (o.ind !== undefined ? series[o.ind][i] : o.price !== undefined ? bars[i][o.price] : fx(o.const));
    const cond = (c, i) => {
      if (c.all) return c.all.every((x) => cond(x, i));
      if (c.any) return c.any.some((x) => cond(x, i));
      if (c.not) return !cond(c.not, i);
      if (c.cmp) {
        const l = value(c.cmp.left, i);
        const r = value(c.cmp.right, i);
        return c.cmp.op === 'gt' ? l > r : c.cmp.op === 'gte' ? l >= r : c.cmp.op === 'lt' ? l < r : l <= r;
      }
      const l0 = value(c.cross.left, i - 1);
      const r0 = value(c.cross.right, i - 1);
      const l1 = value(c.cross.left, i);
      const r1 = value(c.cross.right, i);
      return c.cross.dir === 'above' ? l0 <= r0 && l1 > r1 : l0 >= r0 && l1 < r1;
    };
    const values = Object.fromEntries(indicatorIds.map((id) => [id, toDecimal(series[id][last])]));
    const bar = bars[last];
    const reasons = [];
    let signal = 'hold';

    if (position) {
      const entry = fx(position.entryPrice);
      const long = def.position.side === 'long';
      const pct = (p) => div(mul(entry, p), HUNDRED);
      const stopPrice = long ? sub(entry, pct(stopLoss)) : add(entry, pct(stopLoss));
      if (long ? bar.low <= stopPrice : bar.high >= stopPrice) reasons.push('stop_loss');
      if (takeProfit !== null) {
        const tpPrice = long ? add(entry, pct(takeProfit)) : sub(entry, pct(takeProfit));
        if (!reasons.length && (long ? bar.high >= tpPrice : bar.low <= tpPrice)) reasons.push('take_profit');
      }
      if (!reasons.length && def.risk.maxHoldingBars !== undefined && position.barsHeld >= def.risk.maxHoldingBars) reasons.push('max_holding');
      if (!reasons.length && cond(def.exit, last)) reasons.push('exit_rule');
      if (reasons.length) signal = 'exit';
    } else if (cond(def.entry, last)) {
      if (barsSinceLastExit !== null && barsSinceLastExit < def.execution.cooldownBars) reasons.push('cooldown');
      else { signal = 'enter'; reasons.push('entry_rule'); }
    }
    return deepFreeze({ ready: true, needBars: warmupBars, signal, reasons, values });
  }

  return deepFreeze({
    hash: parsed.hash,
    dslVersion: parsed.dslVersion,
    timeframe: def.timeframe,
    instruments: [...def.universe.instruments],
    warmupBars,
    position: def.position,
    risk: def.risk,
    execution: def.execution,
    evaluate,
  });
}

function readBars(candles) {
  if (!Array.isArray(candles)) throw new StrategyError('INPUT_INVALID', 'candles must be an array');
  if (candles.length > MAX_BARS) throw new StrategyError('INPUT_INVALID', `at most ${MAX_BARS} candles`);
  let prevTime = -Infinity;
  return candles.map((c, i) => {
    if (!c || typeof c !== 'object') throw new StrategyError('INPUT_INVALID', `candle ${i} is not an object`);
    if (!Number.isSafeInteger(c.openTime) || c.openTime <= prevTime) throw new StrategyError('INPUT_INVALID', `candle ${i}: openTime must be an increasing integer (ms)`);
    prevTime = c.openTime;
    const b = {};
    for (const k of PRICE_SOURCES) b[k] = fx(c[k]);
    if (b.high < b.low || b.high < b.open || b.high < b.close || b.low > b.open || b.low > b.close || b.low < 0n) {
      throw new StrategyError('INPUT_INVALID', `candle ${i}: inconsistent OHLC`);
    }
    return b;
  });
}

function readPosition(p, side) {
  if (!p || typeof p !== 'object') throw new StrategyError('INPUT_INVALID', 'position must be an object or null');
  if (p.side !== side) throw new StrategyError('INPUT_INVALID', `position side ${p.side} does not match strategy side ${side}`);
  if (fx(p.entryPrice) <= 0n) throw new StrategyError('INPUT_INVALID', 'position.entryPrice must be positive');
  if (!Number.isSafeInteger(p.barsHeld) || p.barsHeld < 0) throw new StrategyError('INPUT_INVALID', 'position.barsHeld must be a non-negative integer');
}
