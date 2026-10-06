// W3C Trace Context for the trading module (Stage 19).
//
// traceparent = "00-<32 hex trace id>-<16 hex span id>-<2 hex flags>" (W3C), the format
// OpenTelemetry propagates, so a future OTel SDK/exporter can adopt these ids unchanged.
// No OTel dependency is added (apps/api declares none; audit 08: no tracing exists).
// The existing HTTP middleware's X-Trace-ID (a UUID) maps losslessly: its 32 hex digits
// are a valid W3C trace id. Existing log formats are not touched.
//
// The current context lives in AsyncLocalStorage, so it follows async calls without
// threading a parameter through every store; tracedPool writes it into Postgres.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { AuditError } from './errors.mjs';

const TRACE_RE = /^[0-9a-f]{32}$/;
const SPAN_RE = /^[0-9a-f]{16}$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);
const storage = new AsyncLocalStorage();

const hex = (n) => randomBytes(n).toString('hex');
const newSpanId = () => { let s; do { s = hex(8); } while (s === ZERO_SPAN); return s; };

export function newTrace({ sampled = true } = {}) {
  let t; do { t = hex(16); } while (t === ZERO_TRACE);
  return Object.freeze({ traceId: t, spanId: newSpanId(), parentSpanId: null, sampled });
}

/** A child span of `ctx` (same trace). */
export function childSpan(ctx) {
  assertContext(ctx);
  return Object.freeze({ traceId: ctx.traceId, spanId: newSpanId(), parentSpanId: ctx.spanId, sampled: ctx.sampled });
}

export function assertContext(ctx) {
  if (!ctx || !TRACE_RE.test(ctx.traceId) || ctx.traceId === ZERO_TRACE || !SPAN_RE.test(ctx.spanId) || ctx.spanId === ZERO_SPAN) {
    throw new AuditError('INVALID', 'not a valid trace context');
  }
}

export function formatTraceparent(ctx) {
  assertContext(ctx);
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;
}

/** Parse a traceparent header; returns null for anything invalid (W3C: ignore, start a new trace). */
export function parseTraceparent(header) {
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(String(header ?? '').trim().toLowerCase());
  if (!m || m[1] === 'ff' || m[2] === ZERO_TRACE || m[3] === ZERO_SPAN) return null;
  return Object.freeze({ traceId: m[2], spanId: m[3], parentSpanId: null, sampled: (parseInt(m[4], 16) & 1) === 1 });
}

/** Continue the trace of an existing request X-Trace-ID (UUID) — never changes that header's format. */
export function fromRequestTraceId(xTraceId) {
  const t = String(xTraceId ?? '').toLowerCase().replace(/-/g, '');
  if (!TRACE_RE.test(t) || t === ZERO_TRACE) return null;
  return Object.freeze({ traceId: t, spanId: newSpanId(), parentSpanId: null, sampled: true });
}

/** Run `fn` with `ctx` as the current trace context (nests; restores afterwards). */
export function runWithTrace(ctx, fn) {
  assertContext(ctx);
  return storage.run(ctx, fn);
}
/** Run `fn` in a child span of the current context (or a new trace). */
export function runInSpan(fn) {
  const cur = storage.getStore();
  return storage.run(cur ? childSpan(cur) : newTrace(), fn);
}
export const currentTrace = () => storage.getStore() ?? null;
