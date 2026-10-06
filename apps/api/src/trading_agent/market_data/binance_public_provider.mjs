// Binance PUBLIC market data — STUB (Stage 11). Implemented in Stage 21.
//
// Planned endpoints (public, unauthenticated; re-verify against Binance docs in Stage 21):
//   quotes  → GET /api/v3/ticker/bookTicker?symbol=BTCUSDT   (best bid/ask)
//   candles → GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=N
// Constraints recorded for Stage 21:
//   * Binance geo-blocks US IPs; every Satelink Railway service is in us-west2
//     (docs/execution/TI_WORKER_REGION_PLAN.md:6, #445) → must run from a permitted region.
//   * Redistribution terms: docs/legal/MARKET_DATA_TERMS.md (legal review pending) →
//     entitlements scope 'redistribution' stays ungranted until review.
// No network code exists here; both hooks throw NOT_IMPLEMENTED.
import { MarketDataProvider } from './provider.mjs';
import { MarketDataError, Dataset, CandleInterval } from './types.mjs';
import { Venue } from '../brokers/types.mjs';

export const BINANCE_PUBLIC_CAPABILITIES = Object.freeze({
  venue: Venue.BINANCE,
  datasets: Object.freeze([Dataset.QUOTES, Dataset.CANDLES]),
  candleIntervals: Object.freeze(Object.values(CandleInterval)),
  realtime: false,
  implementedInStage: 21,
});

export class BinancePublicDataProvider extends MarketDataProvider {
  capabilities() { return BINANCE_PUBLIC_CAPABILITIES; }
  async _fetchQuote() { throw new MarketDataError('NOT_IMPLEMENTED', 'Binance public quotes are implemented in Stage 21'); }
  async _fetchCandles() { throw new MarketDataError('NOT_IMPLEMENTED', 'Binance public candles are implemented in Stage 21'); }
}
