Run infrastructure, earn **50% of the revenue your node serves**, in USDT,
on-chain. No staking, no lock-up, no slashing.

## Requirements

- A VPS or home server with a public IP
- 2 GB RAM minimum
- 50 GB storage
- Stable network connectivity — uptime determines how much traffic is routed
  to you

## Register

The onboarding flow lives in the [node portal](https://satelink.network/node/setup),
which walks through registration against:

```
POST https://rpc.satelink.network/api/nodes/register
```

Registration is permissionless. After registering, your node appears in the
operator dashboard with uptime, reputation, latency, and served-request
counts — all measured, none simulated.

## Economics

- You earn **50%** of the metered revenue for calls your node serves
  ($0.000015 per $0.00003 call).
- A further **20%** distribution pool rewards top-performing nodes by uptime
  and traffic.
- Earnings accrue in the epoch ledger and become claimable USDT through
  on-chain settlement. Settlement broadcasting is currently in final
  verification (dry-run) — accrual and accounting run continuously; see
  [Revenue Model](/docs/revenue-model) for the honest current status.

### Earnings math (per million routed calls)

| Routed calls/month | Gross revenue | Your 50% |
|---|---|---|
| 100K | $3 | $1.50 |
| 1M | $30 | $15 |
| 10M | $300 | $150 |

Earnings scale with real customer demand — there are no token emissions and
no artificial rewards. If nobody calls the network, nobody earns. That is the
honest model.

## Going offline

Traffic reroutes to healthy nodes; you simply stop earning while offline.
There is **no slashing** — the only penalty is lost opportunity and a lower
reputation score, which affects future routing.

## Monitor your node

The [earnings dashboard](https://satelink.network/node/earnings) shows accrued
earnings, and the network-wide [status page](https://satelink.network/status)
shows measured uptime and latency for the whole gateway.
