# Satelink Network

**Decentralized RPC Gateway with On-Chain USDT Settlement**

Node operators earn USDT on Polygon by routing real blockchain RPC traffic. Developers get reliable, decentralized infrastructure. Platform fee: 30%. Node operators: 50%. Distribution pool: 20%.

## Proven Metrics (Live)

- **1.7M+ API calls** processed
- **$53+ USDT** earned by operators  
- **$220.59/month** projected revenue
- **99.8% uptime** | 85ms avg latency
- **On-chain proof:** [View TX](https://polygonscan.com/tx/0x814d348d3f6cb4164d2aadf99b574d4ca65221d2155a76b0e99a4e8641a1726b)

## Quick Links

- **RPC Endpoint:** https://rpc.satelink.network/rpc/polygon
- **Dashboard:** https://app.satelink.network
- **API Status:** https://rpc.satelink.network/api/status

## Quick Start

```bash
# Test RPC (no API key required for free tier)
curl -X POST https://rpc.satelink.network/rpc/polygon \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Get API key for higher limits
curl -X POST https://rpc.satelink.network/api/keys \
  -H "Content-Type: application/json" \
  -d '{"tier":"free"}'
```

## Stack

- **Backend:** Node.js 20 + Express + PostgreSQL + Redis
- **Frontend:** Next.js 14 + Tailwind + shadcn/ui
- **Contracts:** Solidity + Foundry + OpenZeppelin
- **Network:** Polygon PoS (mainnet 137) | Polygon Amoy (testnet)
- **Settlement:** USDT (ERC-20)

## For Developers

```bash
git clone https://github.com/Satelink-Protocol/Satelink_Network.git
cd Satelink_Network
npm install
cd apps/web && npm install && cd ..
cp .env.example .env  # Fill in: DATABASE_URL, REDIS_URL, JWT_SECRET
npm run dev           # Backend (port 8080)
cd apps/web && npm run dev  # Frontend (port 3000)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SATELINK NETWORK                         │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│  RPC Layer  │  Billing    │   Epoch     │   Settlement     │
│  (Gateway)  │  (Metering) │  (Rewards)  │   (Polygon)      │
├─────────────┴─────────────┴─────────────┴──────────────────┤
│                     Node Network                            │
│        [Router] [VPS] [GPU] [Server] [IoT Device]          │
└─────────────────────────────────────────────────────────────┘
```

- **RPC Gateway:** Routes Polygon RPC calls through distributed nodes
- **Metering:** Real-time usage tracking in PostgreSQL
- **Settlement:** EIP-712 signed claims → on-chain USDT via ClaimsContract
- **Economic Split:** 50/30/20 enforced by smart contracts

## Revenue Model

| Metric | Current | Target |
|--------|---------|--------|
| Hourly rate | $1.26/hr | $500/hr |
| Monthly | $220.59 | $360,000 |
| Growth needed | 1x | 395x |

**Path to $500/hr:** Chainlist listing + node operator growth + enterprise clients

## Supported Chains

| Chain | Endpoint | Chain ID | Status |
|-------|----------|----------|--------|
| Polygon | `/rpc/polygon` | 137 | Live |
| Polygon Amoy | `/rpc/polygon-amoy` | 80002 | Live |
| Ethereum | `/rpc/ethereum` | 1 | Live |
| Arbitrum | `/rpc/arbitrum` | 42161 | Live |
| Base | `/rpc/base` | 8453 | Live |

## Contracts (Polygon Mainnet)

| Contract | Address |
|----------|---------|
| ClaimsContract | `0x6987921e2453f360e314e4424F6c2789F10a1CC9` |
| Treasury | `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` |

## Documentation

- [Integration Guide](docs/INTEGRATION_GUIDE.md)
- [Node Operator Guide](docs/NODE_OPERATOR_GUIDE.md)
- [Paid Tier Quickstart](docs/PAID_TIER_QUICKSTART.md)
- [Deploy to Polygon](docs/DEPLOY_POLYGON.md)
- [Architecture](docs/architecture/AUTONOMOUS_ECONOMIC_PROTOCOL.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT

---

**Revenue first. Rewards second.**

[Website](https://satelink.network) · [Dashboard](https://app.satelink.network) · [RPC](https://rpc.satelink.network)
