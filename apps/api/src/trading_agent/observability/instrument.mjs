// Instrumentation (Stage 29): wrappers and collectors that add spans + metrics WITHOUT changing the
// instrumented modules. Wire them in the composition root (when trading is registered).
const VENUE_UNREACHABLE = new Set(['VENUE_UNAVAILABLE', 'AMBIGUOUS', 'TIMEOUT_BEFORE_ACCEPT']);
const OPS = ['placeOrder', 'getOrder', 'cancelOrder', 'listFills'];

/** Broker adapter → same adapter, every call traced + counted (venue / operation / outcome). */
export function instrumentBroker(adapter, { tracer, metrics, clock = () => new Date() }) {
  const venue = adapter.capabilities().venue;
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function' || !OPS.includes(prop)) return typeof v === 'function' ? v.bind(target) : v;
      return (brokerAccountId, arg) => tracer.withSpan(`broker.${prop}`, {
        'trading.venue': venue, 'trading.operation': prop, 'trading.broker_account.id': brokerAccountId, 'trading.client_order_id': arg?.clientOrderId,
        'trading.instrument': arg?.instrument, 'service.component': 'broker',
      }, async (span) => {
        const t0 = clock().getTime();
        try {
          const r = await v.call(target, brokerAccountId, arg);
          metrics.brokerRequests.inc({ venue, operation: prop, outcome: 'ok' });
          metrics.brokerUp.set({ venue }, 1);
          span.set('trading.outcome', 'ok');
          return r;
        } catch (e) {
          const code = typeof e?.code === 'string' ? e.code : 'ERROR';
          // a venue that answered with a business error (rejected, not found) is still "up"
          metrics.brokerRequests.inc({ venue, operation: prop, outcome: VENUE_UNREACHABLE.has(code) ? 'unreachable' : 'error' });
          metrics.brokerUp.set({ venue }, VENUE_UNREACHABLE.has(code) ? 0 : 1);
          throw e;
        } finally {
          metrics.brokerDuration.observe({ venue, operation: prop }, (clock().getTime() - t0) / 1000);
        }
      });
    },
  });
}

/** Market-data provider → freshness age gauge + stale counter on every read. */
export function instrumentMarketData(provider, { tracer, metrics, venue }) {
  const wrap = (name) => async (...args) => tracer.withSpan(`market_data.${name}`, { 'trading.venue': venue, 'trading.operation': name, 'service.component': 'market_data' }, async (span) => {
    const r = await provider[name](...args);
    if (r?.freshness) {
      metrics.marketDataAge.set({ venue }, Math.max(0, r.freshness.ageMs) / 1000);
      span.set('trading.market_data.age_ms', r.freshness.ageMs);
      span.set('trading.market_data.stale', r.freshness.stale);
      if (r.freshness.stale) metrics.marketDataStale.inc({ venue });
    }
    return r;
  });
  return new Proxy(provider, { get: (t, p) => (['getQuote', 'getCandles'].includes(p) && typeof t[p] === 'function' ? wrap(p) : (typeof t[p] === 'function' ? t[p].bind(t) : t[p])) });
}

/** OMS reconciler → each run traced; failed lookups counted. */
export function instrumentReconciler(reconciler, { tracer, metrics }) {
  return {
    runOnce: (opts) => tracer.withSpan('oms.reconcile', { 'service.component': 'oms', 'trading.operation': 'reconcile' }, async (span) => {
      const out = await reconciler.runOnce(opts);
      if (out.errors) metrics.reconcileErrors.inc(out.errors);
      span.set('trading.reconcile.checked', out.checked); span.set('trading.reconcile.errors', out.errors); span.set('trading.reconcile.updated', out.updated);
      return out;
    }),
  };
}

/** Collector: UNKNOWN orders (count + oldest age) from the OMS store. */
export async function collectUnknownOrders({ omsStore, metrics, clock = () => new Date(), limit = 1000 }) {
  const rows = await omsStore.listForReconcile({ statuses: ['unknown'], limit });
  const now = clock().getTime();
  const oldest = rows.reduce((m, o) => Math.max(m, now - Number(o.unknownSince ?? o.updatedAt ?? now)), 0);
  metrics.unknownCount.set(rows.length);
  metrics.unknownOldest.set(rows.length ? oldest / 1000 : 0);
  return { count: rows.length, oldestSeconds: rows.length ? oldest / 1000 : 0 };
}

/** Collector: engaged kill switches by scope (from Stage 15 events). */
export function collectKillSwitches({ engaged, metrics }) {
  const by = {};
  for (const e of engaged) by[e.scopeType] = (by[e.scopeType] ?? 0) + 1;
  for (const scope of ['global', 'principal', 'broker_account', 'mandate', 'strategy', 'venue', 'instrument']) metrics.killSwitches.set({ scope }, by[scope] ?? 0);
  return by;
}

/** Recorder: a Stage 18 portfolio reconciliation event. */
export function recordPortfolioReconciliation(event, { metrics }) {
  if (event?.status && event.status !== 'match') metrics.portfolioMismatches.inc({ mode: event.mode ?? 'unknown' });
}

/** Collector: revenue variance = |settled − booked| per source (minor units, exact). */
export function collectRevenueVariance({ sources, metrics }) {
  const out = {};
  for (const [source, { settledMinor, bookedMinor }] of Object.entries(sources)) {
    const d = BigInt(settledMinor) - BigInt(bookedMinor);
    const abs = d < 0n ? -d : d;
    metrics.revenueVariance.set({ source }, Number(abs)); // gauge value; the exact figure stays in the books
    out[source] = abs;
  }
  return out;
}
