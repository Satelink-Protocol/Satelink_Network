// Alert rules (Stage 29): ONE definition → Prometheus rule file (deployed later) + an in-process
// evaluator (used by tests for failure injection, and usable by a cron in an environment without a
// Prometheus server). Thresholds are conservative starting points, to be tuned in staging (B-06).
// Existing alerts (Discord / Resend / console D7) are not touched; routing is by label.
export const ALERT_RULES = Object.freeze([
  { name: 'TradingBrokerUnreachable', metric: 'trading_broker_up', agg: 'min_by_label', label: 'venue', op: '<', threshold: 1, forSec: 120, severity: 'critical',
    expr: 'min by (venue) (trading_broker_up) < 1', summary: 'Broker {{ $labels.venue }} unreachable for 2 minutes' },
  { name: 'TradingMarketDataStale', metric: 'trading_market_data_age_seconds', agg: 'max_by_label', label: 'venue', op: '>', threshold: 60, forSec: 300, severity: 'warning',
    expr: 'max by (venue) (trading_market_data_age_seconds) > 60', summary: 'Market data from {{ $labels.venue }} older than 60s for 5 minutes' },
  { name: 'TradingUnknownOrderAging', metric: 'trading_orders_unknown_oldest_age_seconds', agg: 'max', op: '>', threshold: 300, forSec: 0, severity: 'warning',
    expr: 'trading_orders_unknown_oldest_age_seconds > 300', summary: 'An order has been UNKNOWN for over 5 minutes' },
  { name: 'TradingUnknownOrderStuck', metric: 'trading_orders_unknown_oldest_age_seconds', agg: 'max', op: '>', threshold: 1800, forSec: 0, severity: 'critical',
    expr: 'trading_orders_unknown_oldest_age_seconds > 1800', summary: 'An order has been UNKNOWN for over 30 minutes — manual review' },
  { name: 'TradingReconcileErrors', metric: 'trading_reconcile_errors_total', agg: 'increase', windowSec: 600, op: '>', threshold: 5, forSec: 0, severity: 'warning',
    expr: 'increase(trading_reconcile_errors_total[10m]) > 5', summary: 'OMS reconciler failing lookups' },
  { name: 'TradingPortfolioMismatch', metric: 'trading_portfolio_reconciliation_mismatch_total', agg: 'increase', windowSec: 900, op: '>', threshold: 0, forSec: 0, severity: 'critical',
    expr: 'increase(trading_portfolio_reconciliation_mismatch_total[15m]) > 0', summary: 'Positions disagree with the broker' },
  { name: 'TradingGlobalKillSwitch', metric: 'trading_kill_switches_engaged', agg: 'label_value', label: 'scope', labelValue: 'global', op: '>', threshold: 0, forSec: 0, severity: 'critical',
    expr: 'trading_kill_switches_engaged{scope="global"} > 0', summary: 'The global kill switch is engaged' },
  { name: 'TradingKillSwitchEngaged', metric: 'trading_kill_switches_engaged', agg: 'sum', op: '>', threshold: 0, forSec: 0, severity: 'info',
    expr: 'sum(trading_kill_switches_engaged) > 0', summary: 'One or more kill switches are engaged' },
  { name: 'TradingRevenueVariance', metric: 'trading_revenue_variance_minor', agg: 'max_by_label', label: 'source', op: '>', threshold: 0, forSec: 3600, severity: 'warning',
    expr: 'max by (source) (trading_revenue_variance_minor) > 0', summary: 'Settled and booked amounts disagree for {{ $labels.source }} for an hour' },
].map((r) => Object.freeze(r)));

const cmp = (op, a, b) => (op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a === b);

/** Values per series key for one rule, from prom-client JSON (registry.getMetricsAsJSON()) + counter history. */
function seriesValues(rule, metricsJson, history, now) {
  const m = metricsJson.find((x) => x.name === rule.metric);
  const values = m?.values ?? [];
  if (rule.agg === 'max') return { '': values.reduce((a, v) => Math.max(a, v.value), -Infinity) };
  if (rule.agg === 'sum') return { '': values.reduce((a, v) => a + v.value, 0) };
  if (rule.agg === 'label_value') { const v = values.find((x) => x.labels?.[rule.label] === rule.labelValue); return v ? { [rule.labelValue]: v.value } : {}; }
  if (rule.agg === 'min_by_label' || rule.agg === 'max_by_label') {
    const out = {};
    for (const v of values) { const k = v.labels?.[rule.label] ?? ''; out[k] = k in out ? (rule.agg === 'min_by_label' ? Math.min(out[k], v.value) : Math.max(out[k], v.value)) : v.value; }
    return out;
  }
  if (rule.agg === 'increase') {
    const total = values.reduce((a, v) => a + v.value, 0);
    const h = (history[rule.metric] ??= []);
    h.push({ at: now, total });
    while (h.length && h[0].at < now - rule.windowSec * 1000) h.shift();
    return { '': total - (h[0]?.total ?? total) };
  }
  return {};
}

/**
 * In-process evaluator. Call evaluate(nowMs) periodically; returns transitions
 * [{ rule, key, state: 'firing'|'resolved', value }]. `pending` honours forSec like Prometheus.
 */
export class AlertEvaluator {
  #registry; #rules; #state = new Map(); #history = {};
  constructor({ registry, rules = ALERT_RULES }) { this.#registry = registry; this.#rules = rules; }
  async evaluate(nowMs) {
    const json = await this.#registry.getMetricsAsJSON();
    const out = [];
    for (const rule of this.#rules) {
      const vals = seriesValues(rule, json, this.#history, nowMs);
      for (const [key, value] of Object.entries(vals)) {
        const id = `${rule.name}|${key}`;
        const prev = this.#state.get(id) ?? { state: 'inactive', since: null };
        if (Number.isFinite(value) && cmp(rule.op, value, rule.threshold)) {
          const since = prev.state === 'inactive' ? nowMs : prev.since;
          if (prev.state !== 'firing' && nowMs - since >= rule.forSec * 1000) { this.#state.set(id, { state: 'firing', since }); out.push({ rule: rule.name, severity: rule.severity, key, state: 'firing', value }); }
          else if (prev.state === 'inactive') this.#state.set(id, { state: 'pending', since });
        } else if (prev.state !== 'inactive') {
          if (prev.state === 'firing') out.push({ rule: rule.name, severity: rule.severity, key, state: 'resolved', value });
          this.#state.set(id, { state: 'inactive', since: null });
        }
      }
    }
    return out;
  }
  firing() { return [...this.#state].filter(([, s]) => s.state === 'firing').map(([id]) => id); }
}

/** Prometheus rule file (YAML) — generated, never hand-edited. */
export function renderPrometheusRules(rules = ALERT_RULES) {
  const q = (s) => JSON.stringify(s);
  const lines = ['# Generated by apps/api/src/trading_agent/observability/alerts.mjs — do not edit by hand.', 'groups:', '  - name: satelink-trading', '    rules:'];
  for (const r of rules) {
    lines.push(`      - alert: ${r.name}`, `        expr: ${q(r.expr)}`, `        for: ${r.forSec}s`, '        labels:', `          severity: ${r.severity}`, '          team: trading', '        annotations:', `          summary: ${q(r.summary)}`);
  }
  return `${lines.join('\n')}\n`;
}
