// Paper runner (Stage 14): the backtest engine driven by live closed candles.
//
// The engine, evaluator, fill model and params are the SAME objects a backtest uses;
// only the feed differs. This layer turns a live, messy feed into the same ordered
// stream a backtest replays:
//   * unclosed candles are ignored (a live poll always returns the forming bar);
//   * duplicates / already-seen bars are dropped (polls overlap);
//   * bars are released only once every instrument has reached them (watermark),
//     in (openTime, instrument) order, so a shared cash book sees the backtest order;
//   * wall-clock staleness (Stage 11 computeStaleness) marks a bar stale, which
//     suppresses its signal exactly like a data gap does in a backtest.
// It trades a SIMULATED book only: no broker, no orders/fills/positions tables, no ledger.
import { randomBytes } from 'node:crypto';
import { SimError } from '../backtest/errors.mjs';
import { SimulationEngine, SimMode, ENGINE_VERSION, ResultLabel } from '../backtest/engine.mjs';
import { defineSimParams } from '../backtest/params.mjs';
import { toEngineCandle, byTimeThenInstrument } from '../backtest/data.mjs';
import { sealResult } from '../backtest/result.mjs';
import { compileStrategy } from '../strategies/compiler.mjs';
import { computeStaleness, defineStalenessPolicy } from '../market_data/staleness.mjs';
import { INTERVAL_MS } from '../market_data/types.mjs';

export const newPaperRunId = () => `ppr_${randomBytes(12).toString('hex')}`;
const MARKET_DATA_PURPOSE = 'internal_use'; // strategy computation; never redistributed

export class PaperRunner {
  #engine; #def; #sim; #interval; #policy; #clock;
  #lastAccepted = new Map(); #buffer = new Map();
  #stats = { received: 0, unclosed: 0, duplicates: 0, late: 0, released: 0, stale: 0, polls: 0, pollErrors: 0 };
  #stopped = null;

  /**
   * @param {{parsed, params, clock?: () => Date, staleAfterMs?: number}} o
   *   staleAfterMs: a closed bar older than this (since its close) is stale. Default: one bar interval.
   */
  constructor({ parsed, params, clock = () => new Date(), staleAfterMs }) {
    if (!parsed?.definition) throw new SimError('CONFIG', 'PaperRunner needs a parsed strategy');
    this.#def = parsed.definition;
    this.#sim = defineSimParams(params, this.#def);
    this.#interval = INTERVAL_MS[this.#def.timeframe];
    this.#policy = defineStalenessPolicy({ maxAgeMs: staleAfterMs ?? this.#interval });
    this.#clock = clock;
    this.#engine = new SimulationEngine({ compiled: compileStrategy(parsed), definition: this.#def, params: this.#sim.params, mode: SimMode.PAPER });
    for (const id of this.#def.universe.instruments) this.#buffer.set(id, new Map());
  }

  get paramsHash() { return this.#sim.hash; }
  get params() { return this.#sim.params; }
  stats() { return Object.freeze({ ...this.#stats }); }

  /** Accept any batch of candles (engine or Stage 11 shape, any order, overlaps allowed). */
  ingest(candles) {
    if (this.#stopped) throw new SimError('CONFLICT', 'paper run stopped');
    for (const raw of candles) {
      this.#stats.received += 1;
      if (raw?.closed === false) { this.#stats.unclosed += 1; continue; }
      const c = toEngineCandle(raw);
      const buf = this.#buffer.get(c.instrument);
      if (!buf) throw new SimError('INPUT_INVALID', `instrument ${c.instrument} is not in the strategy universe`);
      const last = this.#lastAccepted.get(c.instrument);
      if ((last !== undefined && c.openTime <= last) || buf.has(c.openTime)) { this.#stats.duplicates += 1; continue; }
      buf.set(c.openTime, c);
    }
    this.#release();
  }

  /** Release every buffered bar up to the slowest instrument's latest bar, in global order. */
  #release() {
    let watermark = Infinity;
    for (const [id, buf] of this.#buffer) {
      const latest = Math.max(this.#lastAccepted.get(id) ?? -Infinity, ...buf.keys());
      watermark = Math.min(watermark, latest);
    }
    if (!Number.isFinite(watermark)) return;
    const ready = [];
    for (const buf of this.#buffer.values()) {
      for (const [t, c] of buf) if (t <= watermark) { ready.push(c); buf.delete(t); }
    }
    ready.sort(byTimeThenInstrument);
    for (const c of ready) {
      const now = this.#clock();
      const closeIso = new Date(c.openTime + this.#interval).toISOString();
      const stale = computeStaleness({ kind: 'candle', closed: true, closeTime: closeIso, updatedAt: closeIso }, this.#policy, now).stale;
      if (stale) this.#stats.stale += 1;
      try {
        this.#engine.ingest(c, { stale });
      } catch (e) {
        if (e.code === 'INPUT_INVALID' && /out of order|overlaps/.test(e.message)) { this.#stats.late += 1; continue; }
        throw e;
      }
      this.#lastAccepted.set(c.instrument, c.openTime);
      this.#stats.released += 1;
    }
  }

  /**
   * One poll of a market-data port for every instrument. `marketData.getCandles` is the
   * Stage 11 MarketDataProvider signature (entitlement-checked, purpose internal_use).
   */
  async pump(marketData, principalId, { limit = 3 } = {}) {
    this.#stats.polls += 1;
    for (const id of this.#def.universe.instruments) {
      try {
        const res = await marketData.getCandles(principalId, id, this.#def.timeframe, { purpose: MARKET_DATA_PURPOSE, limit });
        this.ingest(res.data);
      } catch (e) {
        if (e instanceof SimError) throw e;
        this.#stats.pollErrors += 1; // provider/entitlement failure: no data → no signal (fail closed)
      }
    }
  }

  /** Stop: finish the engine and return the sealed, 'simulated'-labelled result. Idempotent. */
  stop(extras = {}) {
    if (!this.#stopped) this.#stopped = sealResult(this.#engine.finish(), { paramsHash: this.#sim.hash, feed: this.stats(), ...extras });
    return this.#stopped;
  }
}

/** Persist a paper run in `backtests` (mode 'paper', label 'simulated'): inserts the running row. */
export async function startPaperRun({ store, runner, principalId, strategyVersionId, definitionHash, clock = () => new Date(), newId = newPaperRunId }) {
  const at = clock().getTime();
  const row = {
    id: newId(), principalId, strategyVersionId, definitionHash, mode: SimMode.PAPER, label: ResultLabel.paper,
    status: 'running', engineVersion: ENGINE_VERSION, params: runner.params, paramsHash: runner.paramsHash,
    dataFrom: null, dataTo: null, createdAt: at, startedAt: at,
  };
  await store.insert(row);
  return Object.freeze({ id: row.id, status: row.status });
}

/** Stop the runner and complete its row with the sealed 'simulated' result. */
export async function stopPaperRun({ store, runner, id, clock = () => new Date() }) {
  const result = runner.stop({ paperRunId: id });
  await store.complete(id, { result, resultHash: result.resultHash, dataHash: null, bars: result.metrics.bars, passed: result.passed, finishedAt: clock().getTime() });
  return result;
}
