// Trading agent — market data subdomain (Stage 11). See ./README.md.
// Internal only: no route, no production Redis client, not imported by app_factory.mjs.
export const DOMAIN = 'market_data';
export const TABLES = Object.freeze(['market_data_entitlements']);
export const FLAGS = Object.freeze(['TRADING_AGENT', 'BINANCE']);
export const STATUS = 'skeleton';

export * from './types.mjs';
export * from './staleness.mjs';
export * from './entitlements.mjs';
export * from './cache.mjs';
export { MarketDataProvider } from './provider.mjs';
export { BinancePublicDataProvider, BINANCE_PUBLIC_CAPABILITIES } from './binance_public_provider.mjs';
