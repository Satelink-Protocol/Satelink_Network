# Satelink Network Status

This file tracks the operational status of the Satelink Network API, interfaces, and smart contracts.

## 🚀 Live Services
- **Backend API (RPC + Admin)**: [api.satelink.network](https://api.satelink.network) / [rpc.satelink.network](https://rpc.satelink.network) (Railway)
- **Frontend App**: [satelink.network](https://satelink.network) (Vercel)
- **Database**: PostgreSQL (Railway) & Redis

## 🔗 Polygon Mainnet (Chain ID 137)
- **Revenue Vault V2**: `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`
- **USDT Contract**: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`

## 💳 Payment Rails
- **x402 (Base `eip155:8453`)**: Active. CDP facilitator handles settlements.
- **Credit Deposits**: Active via Revenue Vault V2.

## 🛠 Active Systems
- `freeTierGate`: Active rate-limiting on anonymous RPC traffic.
- `EpochScheduler`: Aggregates usage for on-chain settlement.
- **Settlement Anchor**: Currently running in `SETTLEMENT_DRY_RUN=1` (dry run mode). **Do not disable without founder confirmation.**

## 🚦 Launch Checklist (single source of truth)
Tagged ENGINEERING (Claude Code / eng can execute) or FOUNDER-GATED (requires a founder decision, credential, or external action).

| Item | Owner |
|---|---|
| M5 human gate: Dodo test payment E2E (real sandbox checkout → webhook → entitlement) | ENGINEERING |
| M2 machine gate: real x402 payment → credits → paid intelligence call, end to end | ENGINEERING |
| Refund/dispute handling: Dodo refund and dispute webhooks must revoke/claw back granted credits (currently absent — see `internal_dodo.js`) | ENGINEERING |
| Key rotation (JWT_SECRET, ADMIN_SECRET_TOKEN, DODO_* secrets, signer key) | FOUNDER-GATED |
| GitHub Pro + branch protection on `main` with 0 required reviewers (so solo merges stay unblocked but checks stay required) | FOUNDER-GATED |
| `satelink_app` least-privilege DB role: create in prod and repoint `DATABASE_URL` to it (see `audit/CONSOLIDATION_REPORT_2026-09-16.md` P1) | FOUNDER-GATED |
| Settlement rail decision + EIP-3009 ADR (broadcast path off `SETTLEMENT_DRY_RUN=1`) | FOUNDER-GATED |
| MCP live E2E (intelligence tools against real payment-gated calls) | ENGINEERING |
| Path-aware x402 (per-resource pricing instead of wildcard `/rpc/:var1`) | ENGINEERING |
| Node-operator dashboard (post-launch) | ENGINEERING |
