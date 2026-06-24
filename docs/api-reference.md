# API Reference

Base URL: `https://rpc.satelink.network`

## Authentication

All requests require an API key via header:

```
X-API-Key: sk_free_abc123
```

Free tier keys start with `sk_free_`, paid keys with `sk_basic_`, `sk_pro_`, or `sk_ent_`.

---

## RPC Gateway

### POST /rpc/:chain

Execute JSON-RPC 2.0 calls on any supported chain.

**Chains:** `polygon`, `polygon-amoy`, `ethereum`, `arbitrum`, `base`

**Request:**
```bash
curl -X POST https://rpc.satelink.network/rpc/polygon \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_free_abc123" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }'
```

**Response:**
```json
{"jsonrpc":"2.0","id":1,"result":"0x3a4b5c6"}
```

**Supported Methods:**
- `eth_blockNumber` — Latest block number
- `eth_getBalance` — Account balance
- `eth_call` — Read contract state
- `eth_sendRawTransaction` — Submit signed transaction
- `eth_getTransactionReceipt` — Transaction status
- `eth_getLogs` — Event logs
- `eth_gasPrice` — Current gas price
- `eth_estimateGas` — Gas estimate
- `eth_getCode` — Contract bytecode
- `eth_getStorageAt` — Storage slot value

**Pricing per method:**
| Method | Cost |
|--------|------|
| eth_blockNumber | $0.000001 |
| eth_getBalance | $0.000010 |
| eth_call | $0.000030 |
| eth_sendRawTransaction | $0.000100 |
| eth_getLogs | $0.000050 |

---

## API Key Management

### POST /api/keys

Create a new API key.

**Request:**
```bash
curl -X POST https://rpc.satelink.network/api/keys \
  -H "Content-Type: application/json" \
  -d '{"tier": "free"}'
```

**Response:**
```json
{
  "ok": true,
  "api_key": "sk_free_abc123def456",
  "tier": "free",
  "daily_limit": 200
}
```

### GET /api/keys/:key/usage

Check usage statistics for an API key.

**Response:**
```json
{
  "ok": true,
  "tier": "free",
  "daily_limit": 200,
  "used_today": 47,
  "remaining": 153,
  "credits_usdt": 0,
  "total_calls": 1247
}
```

### GET /api/keys/:key/deposit-info

Get USDT deposit instructions to upgrade tier.

**Response:**
```json
{
  "ok": true,
  "current_tier": "free",
  "deposit": {
    "address": "0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3",
    "network": "Polygon (ChainId 137)",
    "token": "USDT",
    "token_address": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"
  },
  "pricing": {
    "basic": {"price": 9, "limit": 10000},
    "pro": {"price": 49, "limit": 100000},
    "enterprise": {"price": 199, "limit": 1000000}
  }
}
```

### POST /api/keys/:key/deposit

Verify USDT deposit and upgrade tier.

**Request:**
```json
{
  "tx_hash": "0x...",
  "tier": "pro"
}
```

**Response:**
```json
{
  "ok": true,
  "deposited_usdt": 49,
  "new_tier": "pro",
  "new_daily_limit": 100000
}
```

---

## Public Endpoints

### GET /health

Health check with database latency.

**Response:**
```json
{
  "status": "operational",
  "database": {"status": "connected", "latencyMs": 3},
  "uptimeSeconds": 86400
}
```

### GET /api/status

Network status for monitoring.

**Response:**
```json
{
  "status": "operational",
  "uptime_pct": 99.8,
  "nodes_online": 1,
  "total_requests_24h": 238000,
  "avg_latency_ms": 85,
  "chains_supported": ["polygon", "ethereum", "arbitrum", "base"]
}
```

### GET /api/pricing

Machine-readable pricing catalog.

**Response:**
```json
{
  "provider": "Satelink",
  "pricing_model": "pay_per_use",
  "settlement_token": "USDT",
  "methods": {
    "eth_blockNumber": {"usdt_per_call": 0.000001},
    "eth_call": {"usdt_per_call": 0.000030}
  },
  "free_tier": {"requests_per_day": 200}
}
```

---

## Error Codes

| Code | Meaning | Resolution |
|------|---------|------------|
| 401 | Invalid API key | Check X-API-Key header |
| 429 | Rate limit exceeded | Upgrade tier or wait for reset |
| 500 | Server error | Retry with exponential backoff |

**Rate Limit Response (429):**
```json
{
  "error": "rate_limit_exceeded",
  "used": 200,
  "limit": 200,
  "reset_at": "2026-05-19T00:00:00Z",
  "upgrade_url": "https://app.satelink.network/satelink/os/plans"
}
```
