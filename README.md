# Satelink

**Pay-per-call Polygon JSON-RPC for machines and AI agents.**

Satelink is a machine-commerce runtime: any wallet or agent can call standard
Polygon (chain 137) JSON-RPC — `eth_call`, `eth_getBalance`, `eth_getLogs`, and
the rest — and pay per call with no account, no signup, and no commitment.

## Status (honest)

- The gateway is live at `https://rpc.satelink.network` and serves real traffic
  (hundreds of thousands of requests/day, p50 ~50 ms).
- Two payment rails are live on mainnet:
  - **x402** — HTTP 402 challenge/pay flow, USDC on Base (`eip155:8453`),
    settled through the Coinbase CDP facilitator. Mainnet-proven.
  - **USDT credit deposits** — permissionless deposits to RevenueVaultV2 on
    Polygon, credited automatically to your API key.
- A free tier exists for evaluation; most current traffic is free-tier.
  Paid conversion is early. No revenue numbers are advertised here — anything
  you see is on-chain and verifiable.

## Try it (no key needed)

```bash
curl -X POST https://rpc.satelink.network/rpc/polygon \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

When the free taste runs out you get a machine-readable `402` response that
contains everything needed to pay (x402 challenge or instant trial key) —
agents can self-onboard without a human.

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

## License

MIT

---

[Website](https://satelink.network) · [RPC](https://rpc.satelink.network) · [x402-kit](https://github.com/Satelink-Protocol/x402-kit)
