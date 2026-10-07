// Shared fixture for scorecard / orchestrator tests: a realistic decision input built from the REAL
// engines (Stage 14 backtest, walk-forward, stress, regime, liquidity, data confidence) and the
// Stage 15 risk fixtures. Synthetic market data only.
import { parseStrategyDsl } from '../../src/trading_agent/strategies/index.mjs';
import { runBacktest } from '../../src/trading_agent/backtest/index.mjs';
import { walkForward, stressTest, WALK_FORWARD_CONFIG } from '../../src/trading_agent/validation/index.mjs';
import { barsFromCandles, classifyRegime, analyzeLiquidity, assessDataConfidence } from '../../src/trading_agent/engines/index.mjs';
import { normalizeCandle } from '../../src/trading_agent/market_data/types.mjs';
import { assessPortfolioFit } from '../../src/trading_agent/portfolio/fit.mjs';
import { tradingFlagEnvName as F } from '../../src/trading_agent/flags.mjs';

export const H = 3_600_000;
export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 9, 5, 14, 0);
const T0 = NOW - 400 * H;

export const PARAMS = () => ({
  params: 'satelink.sim-params/1.0', initialCash: '10000', quoteCurrency: 'USDT',
  instruments: { 'BTC-USDT': { tickSize: '0.01', lotSize: '0.001', minQuantity: '0.001', minNotional: '1' } },
  fees: { takerBps: '10', makerBps: '2' }, slippageBps: '10', partialFills: { maxParticipationPct: '100' }, windowBars: 50,
});
export const DSL = parseStrategyDsl({
  dsl: 'satelink.strategy/1.0', name: 'Band', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  entry: { cmp: { op: 'lt', left: { price: 'close' }, right: { const: '97' } } },
  exit: { cmp: { op: 'gt', left: { price: 'close' }, right: { const: '103' } } },
  position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '1' } }, risk: { stopLossPct: '50' },
});
export function oscillating(n, { period = 12, amp = 5, t0 = T0 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + amp * Math.sin((2 * Math.PI * i) / period); const o = 100 + amp * Math.sin((2 * Math.PI * (i - 1)) / period);
    const f = (x) => x.toFixed(2);
    return { instrument: 'BTC-USDT', openTime: t0 + i * H, open: f(o), high: f(Math.max(o, c) + 0.3), low: f(Math.min(o, c) - 0.3), close: f(c), volume: '1000' };
  });
}
export const ORDER = () => ({
  idempotencyKey: 'idem_00000001', principalId: 'prn_alice', brokerAccountId: 'bka_1', mandateId: 'mdt_1', strategyVersionId: 'stv_1',
  origin: 'strategy', approvedBy: 'prn_alice', mode: 'paper', venue: 'binance', instrument: 'BTC-USDT', side: 'buy', type: 'limit',
  quantity: '0.01', limitPrice: '30000',
});
export const RISK_CTX = () => ({
  now: NOW,
  flagsEnv: { [F('TRADING_AGENT')]: 'true', [F('BINANCE')]: 'true' },
  policy: {
    id: 'rsk_1', version: 1, hash: `sha256:${'a'.repeat(64)}`, currency: 'USDT', decimals: 2,
    maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2', maxOpenPositions: 3,
    allowedInstruments: ['BTC-USDT', 'ETH-USDT'], killSwitch: false,
    limits: {
      maxPositionNotionalMinor: '200000', maxPriceDeviationBps: 100, maxQuoteAgeMs: 5000, maxOrdersPerMinute: 10, maxOrdersPerDay: 200,
      duplicateWindowMs: 2000, allowShort: false, breakers: { maxConsecutiveLosses: 5, maxConsecutiveRejects: 10, maxBrokerErrors: 5 },
    },
  },
  killSwitchEvents: [],
  brokerAccount: { id: 'bka_1', principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'active' },
  mandate: {
    id: 'mdt_1', principalId: 'prn_alice', brokerAccountId: 'bka_1', strategyId: 'stg_1', mode: 'copilot', status: 'active',
    maxNotionalMinor: '100000', currency: 'USDT', decimals: 2, validFrom: NOW - DAY, validUntil: NOW + DAY, approvedAt: NOW - DAY, stepUpMethod: 'passkey',
  },
  strategy: { versionId: 'stv_1', strategyId: 'stg_1', state: 'PAPER', instruments: ['BTC-USDT'] },
  instrument: { canonical: 'BTC-USDT', venue: 'binance', tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5', quoteCurrency: 'USDT' },
  quote: { instrument: 'BTC-USDT', bid: '29990', ask: '30010', sourceTime: NOW - 500, stale: false },
  account: { equityMinor: '1000000', cashAvailableMinor: '800000', grossExposureMinor: '100000' },
  activity: {
    idempotencyKeyUsed: false, ordersLastMinute: 0, ordersToday: 3, todayNotionalMinor: '100000', realizedPnlTodayMinor: '-500', unrealizedPnlMinor: '200',
    openPositions: [{ instrument: 'ETH-USDT', quantity: '0.5', notionalMinor: '100000' }], lastSimilarOrderAt: null,
    consecutiveLosses: 0, consecutiveRejects: 0, brokerErrorsInWindow: 0,
  },
});
export const BOOK = { bids: [['29990', '5'], ['29980', '10']], asks: [['30010', '5'], ['30020', '10']] };

let cached = null;
/** Evidence computed once (slow-ish): backtest + walk-forward + stress over 400 bars. */
export function evidence() {
  if (cached) return cached;
  const candles = oscillating(400);
  const backtest = runBacktest({ parsed: DSL, params: PARAMS(), candles });
  const walk = walkForward({ parsed: DSL, params: PARAMS(), candles }, { ...WALK_FORWARD_CONFIG, inSampleBars: 96, outOfSampleBars: 48, stepBars: 48, warmupBars: 24, minWindows: 3 });
  const stress = stressTest({ parsed: DSL, params: PARAMS(), candles });
  const norm = candles.slice(-120).map((c) => normalizeCandle({ venue: 'binance', instrument: 'BTCUSDT', interval: '1h', openTime: new Date(c.openTime).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, closed: true, updatedAt: new Date(c.openTime + H).toISOString() }));
  const dataConfidence = assessDataConfidence({ candles: norm, now: new Date(norm.at(-1).openTime === undefined ? NOW : Date.parse(norm.at(-1).closeTime) + 60_000) });
  const regime = classifyRegime(barsFromCandles(norm), { dataConfidence: dataConfidence.score });
  cached = { candles, backtest, walk, stress, dataConfidence, regime };
  return cached;
}

/** Real portfolio-fit assessment: a small ETH long already held, candidate = 300 USDT of BTC. */
export const PORTFOLIO_FIT = (over = {}) => assessPortfolioFit({
  equity: '10000', positions: [{ instrument: 'ETH-USDT', quantity: '0.5', avgEntryPrice: '2000', mark: '2000' }],
  candidate: { instrument: 'BTC-USDT', side: 'buy', notional: '300', strategyId: 'stg_1' },
  activeStrategies: [{ strategyId: 'stg_1', instruments: ['BTC-USDT'] }], ...over,
});

/** A complete, healthy decision input. Each test mutates a fresh copy. */
export function goodInput() {
  const e = evidence();
  return {
    strategy: { versionId: 'stv_1', definitionHash: DSL.hash, preferredRegimes: ['ranging'] },
    backtest: e.backtest, walkForward: e.walk, stress: e.stress, regime: e.regime, dataConfidence: e.dataConfidence,
    portfolioFit: PORTFOLIO_FIT(),
    liquidity: analyzeLiquidity(BOOK, { side: 'buy', notional: '300' }),
    modelledSlippageBps: '10',
    broker: { status: 'ok' },
    order: ORDER(), riskContext: RISK_CTX(),
    validationTimes: { walk_forward: new Date(NOW - H).toISOString(), stress: new Date(NOW - H).toISOString() },
    dataTimestamp: new Date(NOW - 60_000).toISOString(),
    opportunityId: 'opp_1',
  };
}
