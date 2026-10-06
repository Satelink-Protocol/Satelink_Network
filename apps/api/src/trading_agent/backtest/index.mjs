// Trading agent — backtest subdomain (Stage 14). See ./README.md.
// Not mounted; no public API; nothing schedules the job runner.
export const DOMAIN = 'backtest';
export const TABLES = Object.freeze(['backtests']);
export const FLAGS = Object.freeze(['TRADING_AGENT']);
export const STATUS = 'skeleton';

export { SimError, SimErrorCode } from './errors.mjs';
export { SIM_PARAMS_TAG, SIM_PARAMS_SCHEMA, defineSimParams } from './params.mjs';
export { marketCalendar } from './calendar.mjs';
export { feeFor, slippedPrice, limitPriceFor, participationCap, limitFill, floorToStep, ceilToStep } from './fill_model.mjs';
export { SimulationEngine, SimMode, ResultLabel, DISCLAIMER, ENGINE_VERSION } from './engine.mjs';
export { toEngineCandle, prepareHistory, byTimeThenInstrument } from './data.mjs';
export { sealResult, parityView, backtestEvidence, paperEvidence } from './result.mjs';
export { runBacktest } from './run.mjs';
export { InMemoryBacktestStore, PgBacktestStore } from './store.mjs';
export { BacktestJobService, newBacktestId } from './job.mjs';
