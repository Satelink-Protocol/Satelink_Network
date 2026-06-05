# Revenue Strategy

**Model:** Autonomous machine-to-machine protocol revenue  
**Updated:** 2026-05-11

## Active Revenue Streams

| Stream | Status | Rate | Est. Daily (at scale) |
|--------|--------|------|----------------------|
| RPC Gateway | LIVE | $0.00024/call | $10-100 |
| MEV Relay | LIVE | $0.001-0.005/bundle | $50-500 |
| AI Gateway | Built | $0.001/request | TBD |
| Webhooks | Built | $0.0001/delivery | TBD |

## Revenue Distribution (50/30/20)

```
┌────────────────────────────────────────────┐
│              Total Revenue                 │
│              $0.863048 USDT                │
└────────────────────────────────────────────┘
         │           │           │
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │  50%   │  │  30%   │  │  20%   │
    │ Nodes  │  │Platform│  │ Distrib│
    │$0.4315 │  │$0.2589 │  │$0.1726 │
    └────────┘  └────────┘  └────────┘
         │           │           │
         ▼           ▼           ▼
    NODE-ap-     Treasury     Future
    south-1-     Wallet       Pool
    a09becbb
```

## Settlement

- **Chain:** Polygon Mainnet (137)
- **Token:** USDT (0xc2132D05D31c914a87C6611C10748AEb04B58e8F)
- **Claims Contract:** 0x6987921e2453f360e314e4424F6c2789F10a1CC9
- **Treasury:** 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3
- **Minimum Claim:** $1.00 USDT

## Discovery Channels (Revenue Multipliers)

| Channel | Status | Est. Impact |
|---------|--------|-------------|
| Chainlist | PENDING | 10x traffic |
| ethereum-lists | MERGED | 2x traffic |
| publicnode.com | TODO | 5x traffic |
| WalletConnect | TODO | 20x traffic |
| viem/wagmi | TODO | 5x traffic |

## Pricing Strategy

### Free Tier (No API Key)
- 100 requests/day per IP
- Standard methods only
- No MEV relay access
- Purpose: Discovery, testing

### Paid Tiers
| Tier | Price | Requests/Day | MEV Access |
|------|-------|--------------|------------|
| Basic | $10/mo | 10,000 | Yes |
| Pro | $50/mo | 100,000 | Yes |
| Enterprise | $200/mo | Unlimited | Priority |

## Revenue Projections

**Current State:**
- 365 calls/day average
- $0.086/day revenue
- $2.58/month

**Post-Chainlist Merge (expected):**
- 3,650 calls/day (10x)
- $0.86/day revenue
- $25.80/month

**At Scale (target):**
- 50,000 calls/day
- $12/day revenue
- $360/month

## Key Insight

> **We don't sell to humans. We sell to machines.**
> 
> Every bot, AI agent, arbitrageur, and automation script that discovers
> our RPC generates autonomous, recurring revenue with zero sales effort.
> The only variable is discoverability.
