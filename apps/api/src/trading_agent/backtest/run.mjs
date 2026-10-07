// Pure backtest over a prepared history (Stage 14). Deterministic: same definition,
// params and data → same resultHash.
import { SimError } from './errors.mjs';
import { SimulationEngine, SimMode } from './engine.mjs';
import { defineSimParams } from './params.mjs';
import { prepareHistory } from './data.mjs';
import { sealResult } from './result.mjs';
import { compileStrategy } from '../strategies/compiler.mjs';

/**
 * @param {{parsed: {definition, hash, dslVersion}, params: object, candles: object[]}} o
 *   parsed = parseStrategyDsl() result (or a stored, integrity-checked version).
 */
export function runBacktest({ parsed, params, candles }) {
  if (!parsed?.definition) throw new SimError('CONFIG', 'runBacktest needs a parsed strategy');
  const compiled = compileStrategy(parsed);
  const sim = defineSimParams(params, parsed.definition);
  const { candles: data, dataHash } = prepareHistory(candles, parsed.definition.universe.instruments);
  const engine = new SimulationEngine({ compiled, definition: parsed.definition, params: sim.params, mode: SimMode.BACKTEST });
  for (const c of data) engine.ingest(c);
  return sealResult(engine.finish(), { paramsHash: sim.hash, dataHash, bars: data.length });
}
