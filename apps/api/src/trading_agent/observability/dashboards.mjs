// Grafana dashboard (Stage 29) — generated from the same metric names as the alert rules.
export const PANELS = Object.freeze([
  { title: 'Broker reachability', expr: 'min by (venue) (trading_broker_up)', unit: 'none' },
  { title: 'Broker errors / min', expr: 'sum by (venue, outcome) (rate(trading_broker_requests_total{outcome!="ok"}[5m])) * 60', unit: 'short' },
  { title: 'Broker latency p95', expr: 'histogram_quantile(0.95, sum by (le, venue) (rate(trading_broker_request_duration_seconds_bucket[5m])))', unit: 's' },
  { title: 'Market data age', expr: 'max by (venue) (trading_market_data_age_seconds)', unit: 's' },
  { title: 'Orders in UNKNOWN', expr: 'trading_orders_unknown', unit: 'none' },
  { title: 'Oldest UNKNOWN age', expr: 'trading_orders_unknown_oldest_age_seconds', unit: 's' },
  { title: 'Reconciliation failures', expr: 'increase(trading_reconcile_errors_total[1h])', unit: 'none' },
  { title: 'Portfolio mismatches', expr: 'increase(trading_portfolio_reconciliation_mismatch_total[1h])', unit: 'none' },
  { title: 'Kill switches engaged', expr: 'trading_kill_switches_engaged', unit: 'none' },
  { title: 'Revenue variance (minor units)', expr: 'trading_revenue_variance_minor', unit: 'none' },
]);

export function renderGrafanaDashboard(panels = PANELS) {
  return {
    title: 'Satelink — Trading operations', uid: 'satelink-trading-ops', schemaVersion: 39, version: 1, editable: true, tags: ['satelink', 'trading'],
    time: { from: 'now-6h', to: 'now' },
    templating: { list: [{ name: 'datasource', type: 'datasource', query: 'prometheus' }] },
    panels: panels.map((p, i) => ({ id: i + 1, title: p.title, type: 'timeseries', datasource: { type: 'prometheus', uid: '${datasource}' },
      gridPos: { h: 8, w: 12, x: (i % 2) * 12, y: Math.floor(i / 2) * 8 }, fieldConfig: { defaults: { unit: p.unit }, overrides: [] }, targets: [{ expr: p.expr, refId: 'A' }] })),
  };
}
