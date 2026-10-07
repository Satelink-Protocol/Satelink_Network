// Trading agent — brokers subdomain. See ./README.md.
// Stage 10 adds the venue-agnostic BrokerAdapter contract, normalized types and a
// deterministic MockBroker. STATUS stays "skeleton": no live venue connector exists yet.
export const DOMAIN = "brokers";
export const TABLES = Object.freeze(["broker_accounts"]);
export const FLAGS = Object.freeze(["BINANCE","UPSTOX_COPILOT","UPSTOX_AUTOMATED","ALPACA"]);
export const STATUS = "skeleton";

export * from './types.mjs';
export * from './decimal.mjs';
export * from './errors.mjs';
export * from './status_map.mjs';
export * from './symbols.mjs';
export * from './capabilities.mjs';
export * from './order_request.mjs';
export * from './fills.mjs';
export { BrokerAdapter } from './adapter.mjs';
export { MockBroker, MockScenario, MOCK_CAPABILITIES } from './mock_broker.mjs';
