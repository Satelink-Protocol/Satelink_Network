# Trading observability (Stage 29)

Spans, metrics, alert rules and a dashboard for the trading services. **No new dependency and no new vendor.**

**Traces:**
- OpenTelemetry-shaped spans over the Stage 19 W3C trace context, exported as **OTLP/HTTP JSON** to any OpenTelemetry collector.
- Attributes are allow-listed and redacted. Errors record the code, never the message.

**Metrics:** a **dedicated** `prom-client` registry (`trading_*`). The existing default registry, `/metrics` routes and alerts are untouched.

**Alerts and dashboard:** one definition file produces the Prometheus rule file and the Grafana dashboard JSON (committed under `docs/trading-agent/observability/`). The same definitions feed an in-process evaluator used for failure-injection tests.

| File | Purpose |
|---|---|
| `tracer.mjs` | `Tracer.withSpan`, `sanitizeAttributes` (allow-list + redaction), `InMemorySpanExporter`, `OtlpJsonExporter` (never throws) |
| `metrics.mjs` | `createTradingMetrics()`: broker requests/latency/up, market-data age/stale, UNKNOWN count/oldest age, reconcile errors, portfolio mismatches, kill switches, revenue variance |
| `instrument.mjs` | `instrumentBroker` / `instrumentMarketData` / `instrumentReconciler` (wrappers, no module changes) + collectors |
| `alerts.mjs` | `ALERT_RULES` (9 rules), `AlertEvaluator`, `renderPrometheusRules()` |
| `dashboards.mjs` | `PANELS`, `renderGrafanaDashboard()` |

Wire it in the trading composition root when trading is registered (B-03/B-06/B-10). Point `OtlpJsonExporter` at a collector, and scrape the trading registry, once a backend exists (founder decision; see `docs/monitoring/`).
