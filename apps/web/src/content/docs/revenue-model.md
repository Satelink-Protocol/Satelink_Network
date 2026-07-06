## The split

Every metered dollar is divided by fixed protocol rules:

| Share | Recipient | Purpose |
|---|---|---|
| **50%** | Node operators | Payment for serving routed traffic |
| **30%** | Platform | Infrastructure, development, operations |
| **20%** | Distribution pool | Rewards for top-performing nodes (uptime + traffic) |

## The lifecycle

```
billed call ($0.00003)
  → revenue event            immutable, one per call
  → epoch                    ~10-minute aggregation window
  → settlement batch         payable rollup with the 50/30/20 split applied
  → on-chain settlement      USDT on Polygon PoS
```

- **Revenue events** are the ground truth. Test and phantom data are flagged
  and excluded from every reported figure.
- **Epochs** aggregate events so settlement doesn't pay per-call gas.
- **Settlement batches** become claimable USDT once broadcast.

## Current status — stated honestly

- Metering, revenue events, epoch aggregation, and batch creation are
  **live in production**.
- **On-chain settlement broadcasting is in final verification** (dry-run
  mode). Batches aggregate and are fully accounted, but automated broadcasts
  are intentionally disabled until the settlement signer is funded and real
  external metered revenue crosses the safety threshold. This is a
  deliberate financial-safety guard, not a technical gap — the full
  path was proven on-chain (see the verified first claim on the
  [homepage](https://satelink.network/#proof)).
- Deposits (customer → vault) are fully live and permissionless.

## Verify it yourself

- Vault: [`0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`](https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF) on Polygonscan.
- Live network numbers: [status page](https://satelink.network/status) and
  `GET /api/status` — measured values only, `null` when unknown.
