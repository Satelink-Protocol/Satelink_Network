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

> **Launch policy — payments:** Launch with **one-time credit packs only**. **Dodo subscriptions are DISABLED** (flag `NEXT_PUBLIC_DODO_SUBSCRIPTIONS_ENABLED`, default OFF; PR #386) **until renewal refund matching exists** — a subscription-renewal refund is keyed by a synthetic sub-id and cannot yet be linked back to the funding `payment_id`, so a renewal refund/dispute would resolve as unmatched (no clawback).

| Item | Owner |
|---|---|
| M5 human gate: Dodo test payment E2E (real sandbox checkout → webhook → entitlement) — **NOT RUN** (needs a live Dodo sandbox checkout; code paths ready) | ENGINEERING |
| M2 machine gate: real x402 payment → credits → paid intelligence call, end to end | ENGINEERING |
| Refund/dispute handling: Dodo refund/dispute webhooks claw back / freeze granted credits — **IMPLEMENTED** (PR #386: `POST /internal/dodo/reversal`, idempotent, reversal rows, migrations 033+035; clawback shortfall → `payment_hold` (402); `dispute.expired` kept frozen + alerted). Not yet exercised against a live Dodo sandbox — see M5 gate above | ENGINEERING |
| **Dodo credit-path prod schema**: `payment_sources.source` CHECK must allow `'dodo'` (migration 031/035) and the Dodo columns must exist. **apps/api/migrations/\*.sql have NO auto-runner** — PR #386 ensures this schema in `ensureBillingTables` at boot. **Founder: run the read-only SQL in PR #386 to confirm prod's live CHECK before the first real Dodo payment.** | FOUNDER-GATED |
| Key rotation (JWT_SECRET, ADMIN_SECRET_TOKEN, DODO_* secrets, signer key) | FOUNDER-GATED |
| GitHub Pro + branch protection on `main` with 0 required reviewers (so solo merges stay unblocked but checks stay required) | FOUNDER-GATED |
| `satelink_app` least-privilege DB role: create in prod and repoint `DATABASE_URL` to it (see `audit/CONSOLIDATION_REPORT_2026-09-16.md` P1) | FOUNDER-GATED |
| Settlement rail decision + EIP-3009 ADR (broadcast path off `SETTLEMENT_DRY_RUN=1`) | FOUNDER-GATED |
| MCP live E2E (intelligence tools against real payment-gated calls) | ENGINEERING |
| Path-aware x402 (per-resource pricing instead of wildcard `/rpc/:var1`) | ENGINEERING |
| Node-operator dashboard (post-launch) | ENGINEERING |
