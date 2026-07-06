Canonical terminology, used consistently across the site, docs, consoles, and
codebase.

**Credit** — prepaid USDT balance attached to an API key, deducted
$0.00003 per metered call. Credits never expire.

**Deposit listener** — the service watching Polygon PoS for USDT transfers
to the RevenueVault; credits the sending wallet's account after ~25
confirmations.

**DePIN** — Decentralized Physical Infrastructure Network: real hardware,
operated permissionlessly, coordinated and paid on-chain.

**Distribution pool** — the 20% revenue share distributed to top-performing
nodes based on uptime and traffic.

**Epoch** — an aggregation window (~10 minutes) that rolls individual
revenue events into a settlement batch, so settlement doesn't pay per-call
gas.

**Free-tier gate** — IP-based metering for anonymous callers: 500 calls/day
per IP (and per /24 subnet), reset at UTC midnight, enforced with Redis
counters.

**HTTP 402 flow** — Satelink's machine onboarding: over-limit or unfunded
calls receive `402 Payment Required` with a self-contained, machine-readable
body (registration endpoint, deposit calldata, real minimum, working
examples).

**Machine customer** — a non-human API consumer (agent, bot, service) that
onboards and pays autonomously through the 402 flow.

**Metered rate** — the flat price per billed call: **$0.00003 USDT**
($30 per million calls).

**Node operator** — a permissionless participant serving routed RPC traffic
for 50% of the revenue it generates.

**Revenue event** — the immutable per-call billing record; the canonical
source for every revenue figure. Test/phantom rows are flagged and excluded.

**RevenueVault (V2)** — the production vault contract on Polygon PoS
(`0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`) that receives permissionless
USDT deposits.

**Settlement batch** — a payable rollup of one epoch's revenue with the
50/30/20 split applied; broadcast on-chain when settlement is enabled and
funded.

**Settlement dry-run** — the current safety mode: batches aggregate and are
fully accounted, but on-chain broadcasting is disabled until the signer is
funded, real external revenue crosses the threshold, and a human enables it.

**Wallet-bound key** — an API key created by signing a message with MetaMask
(no gas); deposits from the bound wallet credit the key automatically.
