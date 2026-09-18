# Satelink

**Derived trading intelligence and pay-per-call Polygon RPC — for machines and humans.**

Satelink sells two things on one billing account:

1. **Trading intelligence** — funding-rate divergence, open-interest shifts,
   liquidation clusters, and market microstructure, computed from public
   market data. We never redistribute a raw exchange feed; every response is
   a statistic we derive. `$0.01/call`, one-time USD credit pack (no
   subscription) or pay-per-call via x402.
2. **RPC gateway** — the infrastructure the intelligence product runs on,
   also sold directly: standard Polygon (chain 137) JSON-RPC —
   `eth_call`, `eth_getBalance`, `eth_getLogs`, and the rest — at
   `$0.00003/call`.

Either product is reachable with no account, no signup, and no commitment:
call it, get an HTTP `402`, pay the challenge, keep going.

## Status (honest)

- The gateway is live at `https://rpc.satelink.network` and serves real
  traffic (hundreds of thousands of requests/day, p50 ~50 ms).
- Two payment rails are live on mainnet, and fund the same credit balance for
  both products:
  - **x402** — HTTP 402 challenge/pay flow, USDC on Base (`eip155:8453`),
    settled through the Coinbase CDP facilitator. Mainnet-proven.
  - **USDT credit deposits** — permissionless deposits to RevenueVaultV2 on
    Polygon, credited automatically to your API key.
  - A one-time USD credit pack via Dodo Payments (card/UPI) is the human
    checkout path — see [satelink.network/pricing](https://satelink.network/pricing).
- A free tier exists for evaluation (500 RPC requests/day/IP; a free
  discovery tier for intelligence). Paid conversion is early. No revenue
  numbers are advertised here — anything you see is on-chain and verifiable.

## Try it (no key needed)

```bash
# RPC
curl -X POST https://rpc.satelink.network/rpc/polygon \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Intelligence — free discovery: metrics, prices, how to pay
curl https://rpc.satelink.network/v1/intelligence
```

When the free taste runs out you get a machine-readable `402` response that
contains everything needed to pay (x402 challenge or instant trial key) —
agents can self-onboard without a human.

## Machine-consumer quickstart

1. **Discover the service.** `GET /.well-known/satelink.json` — the machine
   manifest: chain, pricing, payment rails, and the exact onboarding request
   shape. `GET /v1/pricing` — the live rate card the serving path actually
   bills against (tiers, deposit flow, intelligence pricing).
2. **Register (optional — you can also just pay the 402 challenge cold).**
   `POST /v1/machine/register` with `{ wallet_address, signature }` (a
   `personal_sign` of `satelink:register:<lowercase wallet_address>`) →
   returns an `api_key` for the `X-API-Key` header.
3. **Pay.** Either rail credits the same account: an x402 bundle on
   `POST /rpc/polygon` (USDC on Base, no account needed), or a USDT deposit
   to the RevenueVaultV2 address below.
4. **Call.** RPC at `/rpc/<chain>`, intelligence at
   `/v1/intelligence/<metric>` — same API key, same balance, metered per
   call.

```bash
curl https://rpc.satelink.network/.well-known/satelink.json
curl https://rpc.satelink.network/v1/pricing
```

## Ecosystem

- **[x402-kit](https://github.com/Satelink-Protocol/x402-kit)** — standalone,
  MIT-licensed Express middleware that puts an x402 USDC paywall in front of
  any route. Extracted from this codebase, mainnet-proven.
- **MCP server** (`apps/mcp-server`) — gives AI agents Satelink RPC access as
  MCP tools (`satelink-mcp`).

## Contracts (verifiable on-chain)

| Contract | Chain | Address |
|----------|-------|---------|
| RevenueVaultV2 (deposits) | Polygon 137 | `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF` |
| USDT | Polygon 137 | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Treasury / x402 payTo | Polygon / Base | `0x966E1Ae22996545015b1414B35234b10719d7Ad4` |

## Stack

- **Backend:** Node.js + Express (`apps/api`), PostgreSQL + Redis, on Railway
- **Frontend:** Next.js (`apps/web`) at [satelink.network](https://satelink.network)
- **Contracts:** Solidity + Foundry (`contracts/`), Polygon PoS mainnet

## Development

```bash
git clone https://github.com/Satelink-Protocol/Satelink_Network.git
cd Satelink_Network && npm install
cd apps/api && npm test   # mocha; see CLAUDE.md for the known-failure baseline
```

> Do not boot the full app against the production database — the schedulers
> write. See `CLAUDE.md` for safe local verification.

## Legal

[Pricing](https://satelink.network/pricing) ·
[Terms of Service](https://satelink.network/terms) ·
[Privacy Policy](https://satelink.network/privacy) ·
[Refund & Cancellation](https://satelink.network/refund) ·
[Contact](https://satelink.network/contact)

## License

MIT

---

[Website](https://satelink.network) · [RPC](https://rpc.satelink.network) · [Intelligence](https://satelink.network/intelligence) · [x402-kit](https://github.com/Satelink-Protocol/x402-kit)
