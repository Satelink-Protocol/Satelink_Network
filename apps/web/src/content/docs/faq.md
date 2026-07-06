## General

### What is Satelink?

A DePIN RPC gateway on Polygon PoS. Developers and autonomous machines pay
$0.00003 per blockchain RPC call in USDT; node operators earn 50% of routed
revenue; settlement is on-chain and verifiable.

### Is this real or a testnet simulation?

Real. Live on Polygon mainnet with real USDT deposits to a verified vault
contract
([`0x577D…aCEF`](https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF)).
The network is early — the live metrics on the
[status page](https://satelink.network/status) are the honest picture, and we
publish measured numbers rather than marketing claims.

### How is Satelink different from Infura or Alchemy?

Three structural differences: revenue is shared with the people running the
infrastructure (50% to node operators), billing is a flat on-chain metered
rate instead of plan tiers, and onboarding works for machines (HTTP 402 +
ERC-20 payment) — not just humans with credit cards.

## For developers

### What chains are supported?

Polygon PoS (137), Ethereum (1), Arbitrum (42161), Base (8453), and Polygon
Amoy testnet (80002). Per-provider health is public at `/rpc/health`.

### Can I use this in production?

Uptime and latency are measured and published live — we don't sell an SLA
yet. Recommended pattern at this stage: Satelink primary with a fallback RPC
configured, which is good multi-provider hygiene anyway.

### Do I need to trust Satelink with funds?

Deposits go to a verified on-chain vault via a plain ERC-20 transfer from
your own wallet. We never hold your keys. Your credit balance and every
deposit are independently verifiable on Polygonscan.

### What happens when I run out of credits?

Calls return HTTP 402 with exact remediation instructions in the body.
Nothing is silently dropped.

## For node operators

### How much can I earn?

50% of the revenue your node serves: 1M routed calls/month = $30 gross = $15
to you. Earnings scale with real customer demand — there are no token
emissions or artificial APY. Early network honesty: demand is still small;
see the live request counter on the status page before you size hardware.

### Do I need to stake?

No. No staking, no lock-up, and no slashing — going offline just means you
stop earning while offline.

### How do I get paid?

Earnings accrue per epoch in USDT and become claimable through on-chain
settlement. Settlement broadcasting is currently in final verification
(dry-run mode) — accrual and accounting run now; automated broadcasts enable
once the safety gates clear. See [Revenue Model](/docs/revenue-model).

## Economics

### Where does the USDT come from?

Entirely from customers paying for API usage. The split is 50% node
operators / 30% platform / 20% distribution pool for top-performing nodes.

### Can the split change?

The split is enforced in the settlement contracts; changing it requires
deploying new contracts — it cannot drift quietly.
