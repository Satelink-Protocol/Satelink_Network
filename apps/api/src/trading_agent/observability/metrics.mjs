// Metrics (Stage 29): a DEDICATED prom-client registry for trading (the existing default registry,
// its /metrics routes and existing alerts are untouched). Labels are low-cardinality only:
// venue, operation, outcome, scope — never ids, principals or instruments beyond the configured set.
import client from 'prom-client';

export function createTradingMetrics() {
  const registry = new client.Registry();
  const m = {
    registry,
    brokerRequests: new client.Counter({ name: 'trading_broker_requests_total', help: 'Broker adapter calls by venue, operation and outcome', labelNames: ['venue', 'operation', 'outcome'], registers: [registry] }),
    brokerDuration: new client.Histogram({ name: 'trading_broker_request_duration_seconds', help: 'Broker adapter call latency', labelNames: ['venue', 'operation'], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [registry] }),
    brokerUp: new client.Gauge({ name: 'trading_broker_up', help: '1 if the last broker call reached the venue, else 0', labelNames: ['venue'], registers: [registry] }),
    marketDataAge: new client.Gauge({ name: 'trading_market_data_age_seconds', help: 'Age of the latest market data served, by venue', labelNames: ['venue'], registers: [registry] }),
    marketDataStale: new client.Counter({ name: 'trading_market_data_stale_total', help: 'Stale market data served (callers must reject it)', labelNames: ['venue'], registers: [registry] }),
    unknownOldest: new client.Gauge({ name: 'trading_orders_unknown_oldest_age_seconds', help: 'Age of the oldest order in UNKNOWN (0 if none)', registers: [registry] }),
    unknownCount: new client.Gauge({ name: 'trading_orders_unknown', help: 'Orders currently in UNKNOWN', registers: [registry] }),
    reconcileErrors: new client.Counter({ name: 'trading_reconcile_errors_total', help: 'OMS reconciler lookups that failed', registers: [registry] }),
    portfolioMismatches: new client.Counter({ name: 'trading_portfolio_reconciliation_mismatch_total', help: 'Portfolio vs broker reconciliation mismatches', labelNames: ['mode'], registers: [registry] }),
    killSwitches: new client.Gauge({ name: 'trading_kill_switches_engaged', help: 'Engaged kill switches by scope', labelNames: ['scope'], registers: [registry] }),
    revenueVariance: new client.Gauge({ name: 'trading_revenue_variance_minor', help: 'Absolute variance between gateway-settled amounts and booked amounts (minor units)', labelNames: ['source'], registers: [registry] }),
  };
  return m;
}
