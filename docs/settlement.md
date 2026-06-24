# Settlement Architecture — On-Chain USDT Claims

How Satelink settles node operator earnings on Polygon.

## Overview

Satelink is a **trustless revenue distribution system**. Every USDT earned by node operators is verifiable on-chain.

**Core principle:** Revenue exists before rewards are calculated. No emissions. No fake rewards.

## Revenue Flow

```
Developer makes RPC call
         ↓
Node processes request
         ↓
PostgreSQL records revenue_event (USDT amount)
         ↓
Epoch closes every 60 seconds
         ↓
TreasurySettlementJob forwards to ClaimsContract
         ↓
Node operator signs EIP-712 claim
         ↓
ClaimsContract verifies + transfers USDT
         ↓
USDT in node operator's wallet
```

## Smart Contracts

**ClaimsContract:** `0x6987921e2453f360e314e4424F6c2789F10a1CC9`

- Deployed on Polygon PoS (mainnet, chain ID 137)
- Open-source: [GitHub](https://github.com/Satelink-Protocol/Satelink_Network/tree/main/contracts)
- Verified on Polygonscan

**Key functions:**
- `claim(signature, amount, deadline)` — Submit claim with EIP-712 signature
- `createClaim(nodeId, amount, deadline)` — Platform creates claimable balance
- `withdrawFunds(amount)` — Admin withdrawal for treasury management

**Security:**
- ReentrancyGuard (OpenZeppelin)
- AccessControl (CLAIM_CREATOR_ROLE, GOVERNOR_ROLE)
- Pausable (emergency stop)
- 48-hour claim expiry
- Signature replay protection via deadline

## EIP-712 Signature

Node operators sign claims off-chain using EIP-712 (typed structured data):

```javascript
const domain = {
  name: 'SatelinkClaims',
  version: '1',
  chainId: 137,
  verifyingContract: '0x6987921e2453f360e314e4424F6c2789F10a1CC9'
};

const types = {
  Claim: [
    { name: 'nodeId', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
};

const value = {
  nodeId: 'NODE-ap-south-1-a09becbb',
  amount: ethers.parseUnits('15.50', 6),  // 15.50 USDT (6 decimals)
  deadline: Math.floor(Date.now() / 1000) + 172800  // 48 hours
};

const signature = await wallet.signTypedData(domain, types, value);
```

This signature proves:
1. You own the node wallet
2. You're claiming the correct amount
3. Deadline prevents stale claims

## Epoch System

**Epoch duration:** 60 seconds

Every epoch:
1. All revenue_events are summed
2. Split applied: 50% nodes / 30% platform / 20% pool
3. Node operator shares calculated proportionally
4. Epoch marked as CLOSED
5. New epoch opens automatically

**Why epochs?**
- Batching reduces complexity
- Atomic finalization (no partial epochs)
- Clean accounting periods

## Treasury Management

**Treasury wallet:** `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3`

Revenue flows:
1. Developers deposit USDT → treasury
2. TreasurySettlementJob runs every 5 minutes
3. Forwards collected revenue to ClaimsContract (50/30/20 split)
4. Node operators claim from ClaimsContract balance
5. If balance low → Discord alert

**Liquidity guarantee:** ClaimsContract must hold ≥ total claimable amount.

## Claiming Process

### Step 1: Check Claimable Balance

```bash
curl https://rpc.satelink.network/api/nodes/NODE-ap-south-1-a09becbb/earnings \
  -H "Authorization: Bearer YOUR_JWT"
```

Response:
```json
{
  "claimable_usdt": 15.50,
  "total_earned": 16.80,
  "last_claim": "2026-05-17T00:00:00Z"
}
```

### Step 2: Generate Claim Signature

```bash
curl -X POST https://rpc.satelink.network/api/nodes/NODE-ap-south-1-a09becbb/claim \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0xYourWallet"}'
```

Response:
```json
{
  "success": true,
  "signature": {
    "amount_usdt": 15.50,
    "signature": "0x...",
    "deadline": "2026-05-20T00:00:00Z",
    "contract": "0x6987921e2453f360e314e4424F6c2789F10a1CC9"
  }
}
```

### Step 3: Submit On-Chain

Use the signature to call `ClaimsContract.claim()` from your wallet:

```javascript
const tx = await claimsContract.claim(
  signature,
  parseUnits('15.50', 6),
  deadline
);
await tx.wait();
// USDT now in your wallet
```

Or use the dashboard at [app.satelink.network/satelink/os/withdraw](https://app.satelink.network/satelink/os/withdraw)

### Step 4: Verify

Check Polygonscan: `https://polygonscan.com/tx/YOUR_TX_HASH`

USDT arrives in your wallet within 1 block (~2 seconds).

## Proven Example

**First claim ever (v1.0 milestone):**

| Field | Value |
|-------|-------|
| Amount | $1.296464 USDT |
| TX | [0x814d348d...](https://polygonscan.com/tx/0x814d348d3f6cb4164d2aadf99b574d4ca65221d2155a76b0e99a4e8641a1726b) |
| Date | 2026-05-17 |
| Node | NODE-ap-south-1-a09becbb |
| Wallet | 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3 |

Fully verified. Provably real.

## Security Features

### 1. No Double Claims
- Signature includes deadline
- Contract tracks claimed amounts per node
- Duplicate claim → TX reverts

### 2. Expiry Window
- Claims expire 48 hours after generation
- Expired claims → funds re-allocated to next epoch
- Prevents abandoned claims from locking funds

### 3. Solvency Monitoring
- TreasurySettlementJob runs every 5 minutes
- Checks: ClaimsContract balance ≥ pending claims
- If insufficient → Discord alert + pause new claims

### 4. Emergency Pause
- GOVERNOR_ROLE can pause all claims
- Used only for critical bugs
- Unpause requires admin action

## Transparency

**All data is public:**

| Data | Endpoint |
|------|----------|
| Revenue events | `/api/admin/economics` |
| Settlement queue | `/api/admin/settlement` |
| Node earnings | `/api/nodes/:id/earnings` |
| Contract state | [Polygonscan](https://polygonscan.com/address/0x6987921e2453f360e314e4424F6c2789F10a1CC9) |

**No hidden allocations. No insider deals. All revenue on-chain.**
