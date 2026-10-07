// Tracing (Stage 29): OpenTelemetry-shaped spans over the Stage 19 W3C trace context, exported as
// OTLP/HTTP JSON — the vendor-neutral protocol every OpenTelemetry collector accepts — without an
// SDK dependency. Span attributes are ALLOW-LISTED and every value is redacted (Stage 12 rules):
// no secret, key, token, credential or free-form message ever reaches a span.
// Telemetry never breaks the business path: exporter failures are counted and dropped.
import { currentTrace, childSpan, newTrace, runWithTrace } from '../audit/trace_context.mjs';
import { redactString } from '../agent/redaction.mjs';

/** The only attribute keys a trading span may carry (OTel semantic-convention style). */
export const SPAN_ATTRIBUTES = Object.freeze(new Set([
  'trading.venue', 'trading.operation', 'trading.outcome', 'trading.error.code', 'trading.order.id', 'trading.order.state',
  'trading.client_order_id', 'trading.broker_account.id', 'trading.instrument', 'trading.mode', 'trading.principal.id',
  'trading.market_data.age_ms', 'trading.market_data.stale', 'trading.reconcile.checked', 'trading.reconcile.errors',
  'trading.reconcile.updated', 'trading.kill_switch.scope', 'trading.billing.event', 'trading.billing.outcome',
  'service.component',
]));

const SECRET_KEY = /(secret|token|password|api[_-]?key|credential|signature|private|cookie|authorization|pem|seed|mnemonic)/i;

export function sanitizeAttributes(attrs = {}) {
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!SPAN_ATTRIBUTES.has(k) || SECRET_KEY.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = redactString(String(v)).slice(0, 256);
  }
  return out;
}

export class InMemorySpanExporter {
  spans = [];
  async export(spans) { this.spans.push(...spans); }
}

/** OTLP/HTTP JSON exporter (POST {endpoint}/v1/traces). Injected fetch; batches; never throws. */
export class OtlpJsonExporter {
  #endpoint; #fetch; #resource; #headers;
  constructor({ endpoint, fetch, serviceName = 'satelink-trading', headers = {} }) {
    if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint) || typeof fetch !== 'function') throw new TypeError('OtlpJsonExporter needs an http(s) endpoint and fetch');
    this.#endpoint = endpoint.replace(/\/$/, ''); this.#fetch = fetch; this.#headers = headers;
    this.#resource = { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] };
    this.failures = 0;
  }
  static toOtlp(spans, resource) {
    const val = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) });
    return {
      resourceSpans: [{ resource, scopeSpans: [{ scope: { name: 'satelink.trading', version: '1' }, spans: spans.map((s) => ({
        traceId: s.traceId, spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: 1,
        startTimeUnixNano: String(BigInt(s.startMs) * 1_000_000n), endTimeUnixNano: String(BigInt(s.endMs) * 1_000_000n),
        attributes: Object.entries(s.attributes).map(([key, v]) => ({ key, value: val(v) })),
        status: s.status === 'error' ? { code: 2 } : { code: 1 },
      })) }] }],
    };
  }
  async export(spans) {
    try {
      const res = await this.#fetch(`${this.#endpoint}/v1/traces`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...this.#headers }, body: JSON.stringify(OtlpJsonExporter.toOtlp(spans, this.#resource)), signal: AbortSignal.timeout(5_000) });
      if (!res.ok) this.failures += 1;
    } catch { this.failures += 1; }
  }
}

export class Tracer {
  #exporter; #clock; #buffer = []; #max;
  constructor({ exporter, clock = () => new Date(), batchSize = 50 }) {
    if (typeof exporter?.export !== 'function') throw new TypeError('Tracer needs an exporter');
    this.#exporter = exporter; this.#clock = clock; this.#max = batchSize;
  }

  /** Run fn inside a child span of the current trace (or a new trace). Error codes become attributes. */
  async withSpan(name, attributes, fn) {
    const parent = currentTrace();
    const ctx = parent ? childSpan(parent) : newTrace();
    const startMs = this.#clock().getTime();
    const extra = {};
    let status = 'ok';
    try {
      return await runWithTrace(ctx, () => fn({ set: (k, v) => { extra[k] = v; } }));
    } catch (e) {
      status = 'error';
      extra['trading.outcome'] = 'error';
      extra['trading.error.code'] = typeof e?.code === 'string' ? e.code : 'ERROR'; // the code, never the message
      throw e;
    } finally {
      const span = Object.freeze({ name, traceId: ctx.traceId, spanId: ctx.spanId, parentSpanId: ctx.parentSpanId, startMs, endMs: this.#clock().getTime(), status, attributes: sanitizeAttributes({ ...attributes, ...extra }) });
      this.#buffer.push(span);
      if (this.#buffer.length >= this.#max) await this.flush();
    }
  }

  async flush() {
    if (!this.#buffer.length) return;
    const batch = this.#buffer.splice(0);
    try { await this.#exporter.export(batch); } catch { /* telemetry never breaks the business path */ }
  }
}
