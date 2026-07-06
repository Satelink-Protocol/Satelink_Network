Base URL: `https://rpc.satelink.network` (also served as
`api.satelink.network`). All bodies are JSON.

## RPC

### `POST /rpc`

The metered JSON-RPC gateway (Polygon PoS by default). Standard JSON-RPC 2.0
body. Optional `X-API-Key` header; anonymous calls use the IP free tier.

```bash
curl -X POST https://rpc.satelink.network/rpc \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x...","latest"],"id":1}'
```

Error responses you should handle:

| Status | Meaning | Action |
|---|---|---|
| 402 | Free tier exhausted / no credits | Follow the onboarding instructions in the body |
| 429 | Abuse limit (automated non-developer traffic) | Respect `Retry-After` |

### `GET /rpc/health`

Public health of every upstream provider (per-chain success rates, latency,
last error). No auth.

### `GET /rpc/stats/polygon`

Provider circuit-breaker states and edge-cache hit rates. No auth.

## Keys & usage

### `POST /api/keys`

Create an API key. Body: `{"label": "...", "tier": "free", "email": "optional",
"email_consent": false}`. Returns the key once.

### `GET /api/keys/usage`

Header `X-API-Key`. Returns tier, daily limit, requests today, total spend,
and credits remaining.

### `POST /v1/machine/register`

Machine onboarding — registers a machine identity and returns an API key.
Designed to be called from the HTTP 402 body instructions. See
[Machine Customers](/docs/machine-customers).

## Credits

### `GET /credits/initiate?amount=<usdt>`

Returns everything needed to deposit: RevenueVault address, USDT contract
address, chain id (137), the raw amount, and ready-to-send `approve` and
`deposit` calldata, plus a Polygonscan link.

## Status & network

### `GET /api/status`

Live network status: nodes online, current epoch, requests today (Redis
counter, resets UTC midnight), measured uptime and p50 latency over the last
24h of health samples (`null` when there is no sample — never a made-up
number).

### `GET /stats/free-tier`

Active free-tier IPs today, total calls, near-limit count, and the current
free-tier limit.

### `GET /health`

Liveness: `{ ok, server, db, uptime }`.

## Node operators

### `POST /api/nodes/register`

Register a node to serve routed traffic. See
[Node Operators](/docs/node-operators) for the full flow and requirements.

## Conventions

- Machine values (addresses, hashes, keys, amounts) are returned in full —
  truncate for display, never for storage.
- Amounts are USDT with 6 decimals unless a field name says otherwise.
- Admin endpoints (`/admin/*`) exist but are operator-only (header-token
  gated) and intentionally not documented here.
