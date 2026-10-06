// Binance Spot connector (Stage 21). See ./README.md. Flag BINANCE stays OFF; not mounted.
export { BinanceSpotAdapter, BINANCE_ADAPTER_STATE } from './adapter.mjs';
export { BINANCE_ENVIRONMENTS, BINANCE_CLIENT_ID_RE, BINANCE_CLIENT_ID_MAX, LINK_ID_RE, resolveEnvironment } from './config.mjs';
export { BinanceRestClient } from './rest_client.mjs';
export { queryString, wsSignaturePayload, signPayload, assertCredential } from './signing.mjs';
export { evaluateApiRestrictions, REQUIRED_FALSE, REQUIRED_TRUE } from './key_validation.mjs';
export { linkPrefix, toVenueClientId, fromVenueClientId, orderSnapshot, mapExecutionReport, tradesToFills, feeOf } from './mapping.mjs';
export { instrumentsFromExchangeInfo } from './exchange_info.mjs';
export { ExchangeLinkRebateSource, LinkAndTradeRebateSource } from './rebates.mjs';
