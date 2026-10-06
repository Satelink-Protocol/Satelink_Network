# /v1/trading API + MCP (Stage 24)

The one safe surface for the console, API clients and external agents. **Not registered in
`app_factory.mjs`:** the blocker register keeps the trading module unmounted while B-03, B-06 and B-10 are open.
When registration is approved, it is a single call: `mountTradingRoutes(app, { env, api })`. Even then
every route is a 404 unless `TRADING_FLAG_TRADING_AGENT=true`.

| File | Purpose |
|---|---|
| `router.mjs` | `createTradingApiRouter`: the route table (`ROUTES`), the middleware order, envelopes |
| `middleware.mjs` | flag gate (404), authentication + tenant check, CSRF, human-only mutations, rate limits, Idempotency-Key, step-up |
| `ports.mjs` | `createServicePorts`: adapters onto the Stage 13–19 services with ownership checks; 501 where no read model exists |
| `mcp.mjs` | MCP JSON-RPC (initialize, tools/list, tools/call, ping) over the Stage 12 ToolRegistry: READ + propose only |
| `errors.mjs` | domain code → HTTP status; 5xx never leak internals |

Middleware order: flag gate → JSON → authenticate → (`/mcp`: MCP flag, rate limit, JSON-RPC) → CSRF →
human-only mutations → rate limit → Idempotency-Key → step-up (per route) → handler.

OpenAPI: `docs/trading-agent/api/trading-v1.openapi.json`. The contract test checks it against `ROUTES` in both directions.
