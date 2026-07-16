> ⚠️ **STALE (marked 2026-07-16):** references contract `0x6987…1CC9`, which was never the production contract (purged from the site in PR #237). Current deposit vault: RevenueVaultV2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`. Verify against CLAUDE.md before trusting anything below.

# Pricing

Satelink offers simple, transparent pricing with pay-per-use USDT settlement on Polygon.

## API Tiers

| Tier | Daily Limit | Monthly Price | Per-Call Rate |
|------|-------------|---------------|---------------|
| **Free** | 500/day | $0 | $0 |
| **Basic** | 10,000/day | $9 | $0.000030 |
| **Pro** | 100,000/day | $49 | $0.000016 |
| **Enterprise** | 1,000,000/day | $199 | $0.0000066 |

## Method Pricing

Different RPC methods have different costs based on compute requirements:

| Method | Cost per Call |
|--------|---------------|
| `eth_blockNumber` | $0.000001 |
| `eth_chainId` | $0.000001 |
| `eth_gasPrice` | $0.000005 |
| `eth_getBalance` | $0.000010 |
| `eth_getTransactionCount` | $0.000010 |
| `eth_getCode` | $0.000020 |
| `eth_call` | $0.000030 |
| `eth_estimateGas` | $0.000030 |
| `eth_getTransactionReceipt` | $0.000020 |
| `eth_getLogs` | $0.000050 |
| `eth_sendRawTransaction` | $0.000100 |

**Average cost:** ~$0.000030 per call

## Free Tier Details

- **500 requests per day** (resets at midnight UTC)
- All RPC methods supported
- All chains supported (Polygon, Ethereum, Arbitrum, Base)
- No credit card required
- No expiration

## Upgrading

### Step 1: Get Deposit Info

```bash
curl https://rpc.satelink.network/api/keys/YOUR_KEY/deposit-info
```

Returns:
```json
{
  "deposit": {
    "address": "0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3",
    "network": "Polygon (ChainId 137)",
    "token": "USDT"
  }
}
```

### Step 2: Send USDT

Send the tier price in USDT to the treasury address on Polygon mainnet.

| Tier | Send Amount |
|------|-------------|
| Basic | $9 USDT |
| Pro | $49 USDT |
| Enterprise | $199 USDT |

### Step 3: Submit TX Hash

```bash
curl -X POST https://rpc.satelink.network/api/keys/YOUR_KEY/deposit \
  -H "Content-Type: application/json" \
  -d '{"tx_hash":"0x...","tier":"pro"}'
```

Response:
```json
{
  "ok": true,
  "deposited_usdt": 49,
  "new_tier": "pro",
  "new_daily_limit": 100000
}
```

**Instant activation** — no waiting period.

## Enterprise Plans

For teams needing more than 1M requests/day:

| Feature | Enterprise+ |
|---------|-------------|
| Daily limit | Custom |
| Dedicated nodes | Available |
| SLA guarantee | 99.9% |
| Priority support | 24/7 |
| Custom methods | Supported |

Contact: enterprise@satelink.network

## Settlement

All payments settle on Polygon mainnet:

- **Token:** USDT (0xc2132D05D31c914a87C6611C10748AEb04B58e8F)
- **Chain:** Polygon PoS (chainId 137)
- **Treasury:** 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3
- **ClaimsContract:** 0x6987921e2453f360e314e4424F6c2789F10a1CC9

## Revenue Distribution

When you pay for API usage, revenue is distributed:

| Recipient | Share |
|-----------|-------|
| Node Operators | 50% |
| Platform | 30% |
| Distribution Pool | 20% |

This means **50% of your payment goes directly to node operators** running the infrastructure.

## Billing FAQ

**Q: What happens if I exceed my daily limit?**

A: Requests return HTTP 429. Upgrade your tier or wait for midnight UTC reset.

**Q: Are unused requests rolled over?**

A: No. Daily limits reset at midnight UTC.

**Q: Can I get a refund?**

A: Deposits are non-refundable but never expire. Your tier remains active indefinitely.

**Q: Is there a minimum deposit?**

A: Yes, $9 USDT (Basic tier minimum).

**Q: Which chains are included?**

A: All chains (Polygon, Ethereum, Arbitrum, Base) are included in every tier.

## Compare to Alternatives

| Provider | Free Tier | Paid Starting |
|----------|-----------|---------------|
| **Satelink** | 500/day | $9/month |
| Alchemy | 300M CU/month | $49/month |
| Infura | 100K/day | $50/month |
| QuickNode | None | $49/month |

**Satelink advantage:** Direct USDT settlement, decentralized infrastructure, transparent pricing.