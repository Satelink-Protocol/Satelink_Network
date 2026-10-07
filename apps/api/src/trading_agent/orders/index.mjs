// Trading agent — orders subdomain (Stage 09 skeleton; no runtime behaviour yet).
// See ./README.md.
export const DOMAIN = "orders";
export const TABLES = Object.freeze(["orders","order_events"]);
export const FLAGS = Object.freeze(["TRADING_AGENT","LIVE_TRADING","LIVE_SMALL"]);
export const STATUS = "skeleton";
