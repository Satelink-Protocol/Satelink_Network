// Backtest job (Stage 14): enqueue → claim → run → complete/fail.
//
// Nothing schedules this. runOnce() is the unit a worker would call (the in-process
// timer convention from audit 02, or a future separate worker); wiring it is a later,
// flag-gated stage. Historical candles come from an injected port and must be data
// the principal is entitled to use internally (Stage 11 entitlements; B-09).
import { randomBytes } from 'node:crypto';
import { SimError } from './errors.mjs';
import { SimulationEngine, SimMode, ENGINE_VERSION, ResultLabel } from './engine.mjs';
import { defineSimParams } from './params.mjs';
import { prepareHistory } from './data.mjs';
import { sealResult } from './result.mjs';

const PRN_RE = /^prn_[A-Za-z0-9_]{1,64}$/;
export const newBacktestId = () => `bkt_${randomBytes(12).toString('hex')}`;

export class BacktestJobService {
  #store; #strategies; #history; #clock; #newId;

  /**
   * @param {{store, strategies: {getVersion, compileVersion}, history: {getCandles}, clock?, newId?}} deps
   *   strategies = StrategyService (integrity-checked reads); history.getCandles({venue, instruments, timeframe, fromMs, toMs}).
   */
  constructor({ store, strategies, history, clock = () => new Date(), newId = newBacktestId }) {
    if (!store || !strategies || !history) throw new SimError('CONFIG', 'BacktestJobService needs store, strategies and history');
    this.#store = store; this.#strategies = strategies; this.#history = history; this.#clock = clock; this.#newId = newId;
  }

  async enqueue({ principalId, strategyVersionId, fromMs, toMs, params }) {
    if (!PRN_RE.test(principalId ?? '')) throw new SimError('CONFIG', 'principalId required');
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || toMs <= fromMs) throw new SimError('CONFIG', 'fromMs < toMs required');
    const version = await this.#strategies.getVersion(strategyVersionId);
    const sim = defineSimParams(params, version.definition);
    const row = {
      id: this.#newId(), principalId, strategyVersionId, definitionHash: version.definitionHash,
      mode: SimMode.BACKTEST, label: ResultLabel.backtest, status: 'queued', engineVersion: ENGINE_VERSION,
      params: sim.params, paramsHash: sim.hash, dataFrom: fromMs, dataTo: toMs, createdAt: this.#clock().getTime(),
    };
    await this.#store.insert(row);
    return Object.freeze({ id: row.id, status: row.status });
  }

  /** Claim and run the oldest queued backtest. Returns null when the queue is empty. */
  async runOnce() {
    const job = await this.#store.claimNext(this.#clock().getTime());
    if (!job) return null;
    try {
      const version = await this.#strategies.getVersion(job.strategyVersionId);
      if (version.definitionHash !== job.definitionHash) throw new SimError('CONFLICT', 'strategy version changed since enqueue');
      const compiled = await this.#strategies.compileVersion(job.strategyVersionId);
      const def = version.definition;
      const sim = defineSimParams(job.params, def);
      if (sim.hash !== job.paramsHash) throw new SimError('CONFLICT', 'stored params do not match their hash');
      const raw = await this.#history.getCandles({ venue: def.universe.venue, instruments: def.universe.instruments, timeframe: def.timeframe, fromMs: job.dataFrom, toMs: job.dataTo });
      const { candles, dataHash } = prepareHistory(raw, def.universe.instruments);
      if (candles[0].openTime < job.dataFrom || candles.at(-1).openTime >= job.dataTo) throw new SimError('DATA_INVALID', 'history port returned candles outside the requested window');
      const engine = new SimulationEngine({ compiled, definition: def, params: sim.params, mode: SimMode.BACKTEST });
      for (const c of candles) engine.ingest(c);
      const result = sealResult(engine.finish(), { paramsHash: sim.hash, dataHash, bars: candles.length, backtestId: job.id });
      await this.#store.complete(job.id, { result, resultHash: result.resultHash, dataHash, bars: candles.length, passed: result.passed, finishedAt: this.#clock().getTime() });
      return Object.freeze({ id: job.id, status: 'completed', passed: result.passed, resultHash: result.resultHash });
    } catch (e) {
      await this.#store.fail(job.id, `${e.code ?? 'ERROR'}: ${e.message}`, this.#clock().getTime());
      return Object.freeze({ id: job.id, status: 'failed', error: e.code ?? 'ERROR' });
    }
  }
}
