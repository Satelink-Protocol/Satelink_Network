> ⚠️ **STALE (marked 2026-07-16):** references contract `0x6987…1CC9`, which was never the production contract (purged from the site in PR #237). Current deposit vault: RevenueVaultV2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`. Verify against CLAUDE.md before trusting anything below.

# Node Operator Guide

Earn USDT by running a Satelink node. Route RPC traffic and receive 50% of all revenue your node generates.

## How It Works

```
Developer Request → Satelink Gateway → Your Node → Response
                         ↓
              Revenue recorded in PostgreSQL
                         ↓
              Epoch closes (every 60 seconds)
                         ↓
              50% allocated to node operators
                         ↓
              Claim USDT on Polygon mainnet
```

## Revenue Split

| Recipient | Share |
|-----------|-------|
| Node Operators | 50% |
| Platform Fee | 30% |
| Distribution Pool | 20% |

## Proven Earnings

- **Total earned:** $53+ USDT
- **First claim TX:** [0x814d348d...](https://polygonscan.com/tx/0x814d348d3f6cb4164d2aadf99b574d4ca65221d2155a76b0e99a4e8641a1726b)
- **ClaimsContract:** [0x6987921e2453f360e314e4424F6c2789F10a1CC9](https://polygonscan.com/address/0x6987921e2453f360e314e4424F6c2789F10a1CC9)

## Requirements

- **Server:** VPS, dedicated server, or home server
- **Network:** Stable internet connection
- **Wallet:** Polygon-compatible wallet for receiving USDT
- **Uptime:** 99%+ recommended (affects reputation score)

## Quick Start

### 1. Register Your Node

```bash
curl -X POST https://rpc.satelink.network/api/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0xYourWalletAddress",
    "region": "us-east-1",
    "node_type": "vps"
  }'
```

Response:
```json
{
  "ok": true,
  "node_id": "NODE-us-east-1-abc123",
  "pair_code": "PAIR-xyz789",
  "status": "pending"
}
```

### 2. Install Node Software

```bash
# Clone the node runner
git clone https://github.com/Satelink-Protocol/satelink-node.git
cd satelink-node

# Configure
cp .env.example .env
# Edit .env with your NODE_ID and PAIR_CODE

# Start
docker-compose up -d
```

### 3. Verify Registration

```bash
curl https://rpc.satelink.network/api/nodes/NODE-us-east-1-abc123/stats
```

Response:
```json
{
  "ok": true,
  "node_id": "NODE-us-east-1-abc123",
  "status": "active",
  "uptime_pct": 99.8,
  "total_requests": 45000,
  "earnings_usdt": 2.34
}
```

## Claiming Earnings

### Via Dashboard

1. Visit [app.satelink.network/satelink/os/withdraw](https://app.satelink.network/satelink/os/withdraw)
2. Connect your wallet
3. Click "Claim Earnings"
4. Confirm transaction in MetaMask
5. USDT arrives in ~10 seconds

### Via API

```bash
# Get JWT token first
TOKEN=$(curl -X POST https://rpc.satelink.network/api/auth/node-token \
  -H "Content-Type: application/json" \
  -d '{"nodeId":"NODE-us-east-1-abc123","signature":"0x..."}' \
  | jq -r '.token')

# Generate claim signature
curl -X POST https://rpc.satelink.network/api/nodes/NODE-us-east-1-abc123/claim \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0xYourWallet"}'
```

Response:
```json
{
  "success": true,
  "signature": {
    "amount_usdt": 2.34,
    "signature": "0x...",
    "deadline": "2026-05-20T00:00:00Z",
    "contract": "0x6987921e2453f360e314e4424F6c2789F10a1CC9"
  }
}
```

Then call `ClaimsContract.claim()` with the signature.

## Earnings Calculation

```
Your Earnings = (Your Requests / Total Requests) × Node Pool

Example:
- Total epoch revenue: $10 USDT
- Node pool (50%): $5 USDT
- Your requests: 1,000
- Total requests: 10,000
- Your share: 10% × $5 = $0.50 USDT
```

## Reputation System

| Factor | Weight | Impact |
|--------|--------|--------|
| Uptime | 40% | Higher uptime = more traffic routed |
| Response time | 30% | Faster nodes get priority |
| Success rate | 20% | Failed requests hurt reputation |
| Age | 10% | Older nodes trusted more |

## Thresholds

- **Offline threshold:** 24 hours (node marked offline)
- **Suspend threshold:** 7 days (node suspended, no earnings)
- **Minimum claim:** $0.01 USDT

## Monitoring

### Check Your Stats

```bash
curl https://rpc.satelink.network/api/nodes/YOUR_NODE_ID/stats
```

### View Earnings History

```bash
curl https://rpc.satelink.network/api/nodes/YOUR_NODE_ID/earnings
```

### Subscribe to Events (WebSocket)

```javascript
const ws = new WebSocket('wss://rpc.satelink.network/os/events');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'epoch:closed') {
    console.log('Epoch closed, earnings:', data.node_pool);
  }
};
```

## Support

- Dashboard: [app.satelink.network](https://app.satelink.network)
- Email: operators@satelink.network
- Discord: [discord.gg/satelink](https://discord.gg/satelink)