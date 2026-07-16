> ⚠️ **STALE (marked 2026-07-16):** references contract `0x6987…1CC9`, which was never the production contract (purged from the site in PR #237). Current deposit vault: RevenueVaultV2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`. Verify against CLAUDE.md before trusting anything below.

# USDT Settlement Flow — Satelink

Complete trace of the revenue path from node heartbeat to USDT payout on Polygon.

---

## Overview

```
Node heartbeat (POST /v1/node/heartbeat)
         ↓
Node marked ACTIVE in registry
         ↓
RPC request processed → revenue_events_v2 row written (amount_usdt)
         ↓
EpochCloseJob runs at midnight UTC
  └─ Aggregates revenue_events_v2 by epoch
  └─ Applies 50/30/20 split
  └─ Creates epoch_earnings + claims rows per node
  └─ Opens next epoch
         ↓
SettlementAnchorJob runs after epoch close
  └─ Queries epochs WHERE status='CLOSED' AND no settlement_batches row
  └─ Inserts settlement_batches row (status=pending)
  └─ Sends USDT transfer to TREASURY_ADDRESS on Polygon (or MATIC anchor fallback)
  └─ Updates settlement_batches with tx_hash and status=confirmed
         ↓
TreasurySettlementJob runs every 5 minutes
  └─ Checks USDT balance at TREASURY_ADDRESS on Polygon mainnet
  └─ If balance increased > $1.00 threshold:
       → Splits 50% → ClaimsContract (node operators)
       → 30% stays in treasury (platform fee)
       → 20% stays in treasury (distribution pool)
  └─ Sends USDT transfer to ClaimsContract on-chain
  └─ Calls creditNodeEarnings() → inserts claims rows per active node
         ↓
Node operator calls POST /api/nodes/:id/claim
  └─ claim_processor.js generates EIP-712 signed message
  └─ Operator submits signature to ClaimsContract.claim() on Polygon
  └─ ClaimsContract verifies signature + transfers USDT to wallet
  └─ USDT arrives in node operator wallet (operator pays gas)
```

---

## Key Contracts

| Contract | Address | Network |
|----------|---------|---------|
| RevenueVault | `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` | Polygon PoS (chainId 137) |
| ClaimsContract | `0x6987921e2453f360e314e4424F6c2789F10a1CC9` | Polygon PoS (chainId 137) |
| USDT (Polygon) | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | Polygon PoS (chainId 137) |

ClaimsContract functions used:
- `claim(signature, amount, deadline)` — node operator submits EIP-712 claim
- `createClaim(nodeId, amount, deadline)` — platform creates claimable balance

---

## Revenue Split (immutable without CEO + governance approval)

| Pool | Share | Destination |
|------|-------|-------------|
| Node operators | 50% | ClaimsContract → per-node claims |
| Platform treasury | 30% | TREASURY_ADDRESS (held) |
| Distribution pool | 20% | TREASURY_ADDRESS (tracked) |

---

## Key Files

| File | Role |
|------|------|
| `apps/api/src/nodes/node_heartbeat.js` | Receives node heartbeats, marks nodes ACTIVE |
| `apps/api/src/scheduler/jobs/epoch_close_job.js` | Closes epochs nightly, writes claims |
| `apps/api/src/scheduler/jobs/settlement_anchor_job.js` | Anchors epoch Merkle root on-chain |
| `apps/api/src/jobs/treasury_settlement_job.mjs` | Forwards treasury deposits to ClaimsContract |
| `apps/api/src/services/claims/claim_processor.js` | Generates EIP-712 signatures for claims |
| `apps/api/src/routes/claims_route.mjs` | REST endpoints for claim lifecycle |
| `contracts/EpochAnchor.sol` | On-chain epoch Merkle root storage |
| `contracts/RevenueVault.sol` | USDT vault with role-gated withdraw |
| `contracts/ClaimsWithdrawals.sol` | Node operator pull-model withdrawals |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `revenue_events_v2` | Append-only log of every billable RPC call |
| `epochs` | Epoch lifecycle (OPEN → CLOSED) with revenue totals |
| `epoch_earnings` | Per-node earnings per epoch |
| `claims` | Claimable amounts per node (pending → confirmed) |
| `settlement_batches` | On-chain anchor records with tx_hash |
| `treasury_state` | Last-known treasury balance for deposit detection |
| `treasury_settlements` | Log of every treasury→ClaimsContract transfer |

---

## Required Environment Variables

```
POLYGON_RPC_URL          - Polygon RPC endpoint
POLYGON_SIGNER_KEY       - Hot wallet private key (for SettlementAnchorJob)
TREASURY_SIGNER_KEY      - Treasury wallet private key (for TreasurySettlementJob)
POLYGON_USDT_ADDRESS     - USDT contract address on Polygon
POLYGON_CHAIN_ID         - 137 (mainnet) or 80002 (Amoy testnet)
TREASURY_ADDRESS         - Treasury wallet address
CLAIMS_CONTRACT_ADDRESS  - ClaimsContract address
SETTLEMENT_EVM_SIGNER_PRIVATE_KEY - Signer for EIP-712 claim signatures
SETTLEMENT_DRY_RUN       - Set to '1' to simulate without sending real txs
```

---

## Claim Expiry

Claims expire after **48 hours** from epoch close. Expired claim amounts are swept back to treasury by `claim_expiry_job.js`.

---

## Testnet (Amoy) Usage

Set `POLYGON_CHAIN_ID=80002` and `POLYGON_RPC_URL=https://rpc-amoy.polygon.technology` to operate on Polygon Amoy testnet. Use MockUSDT (`contracts/MockUSDT.sol`) for test deposits. The claim signing domain uses `chainId: 137` (mainnet hardcoded in claim_processor.js) — update to `80002` for full testnet claim testing.

---

## Bugs Fixed (C2-1)

- `treasury_settlement_job.mjs` `creditNodeEarnings()`: fixed column mismatch — `wallet_address` → `wallet` and removed non-existent `reputation_score` from SELECT. The `nodes` table uses `wallet TEXT`, not `wallet_address`.
- `epoch_close_job.js`: fixed INSERT into `claims` — `wallet_address` column → `wallet` (matching schema from `003_balances_claims_withdrawals.sql`).