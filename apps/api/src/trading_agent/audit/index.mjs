// Trading agent — audit subdomain. Stage 19: append-only audit trail (migration 029 triggers),
// W3C trace propagation and the "Why did Satelink do this?" receipt. See ./README.md.
// Not mounted; no public API. STATUS stays 'skeleton' (= not wired at runtime).
export const DOMAIN = "audit";
export const TABLES = Object.freeze(["audit_events"]);
export const FLAGS = Object.freeze(["TRADING_AGENT"]);
export const STATUS = "skeleton";

export { AuditError, AuditErrorCode } from './errors.mjs';
export { newTrace, childSpan, formatTraceparent, parseTraceparent, fromRequestTraceId, runWithTrace, runInSpan, currentTrace, assertContext } from './trace_context.mjs';
export { tracedPool } from './traced_pool.mjs';
export { TradeReceiptAssembler, RECEIPT_VERSION } from './receipt.mjs';
export { PgReceiptSource } from './source.mjs';
