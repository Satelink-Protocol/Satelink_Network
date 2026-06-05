# Satelink Paid Tier — Quick Start Guide

Machine-readable onboarding for operators, DApps, and automated scripts.

---

## Overview

Satelink provides 500 free RPC calls/day per IP address.  
To make unlimited calls, deposit USDT and pass your wallet address as a header.

**Endpoint:** `https://rpc.satelink.network/rpc/polygon`  
**Network:** Polygon Mainnet (chainId: 137)  
**Settlement token:** USDT (6 decimals)

---

## Step 1: Approve USDT to RevenueVault

```javascript
// USDT contract on Polygon Mainnet
const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const REVENUE_VAULT = "0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3";

const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);
const amount = ethers.parseUnits("1.0", 6); // 1 USDT minimum

await usdt.approve(REVENUE_VAULT, amount);
```

---

## Step 2: Deposit USDT

```javascript
// RevenueVault ABI (minimal)
const VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "event Deposited(address indexed from, uint256 amount)"
];

const vault = new ethers.Contract(REVENUE_VAULT, VAULT_ABI, signer);
await vault.deposit(amount);
```

The deposit is credited to your wallet address automatically within ~30 seconds.

---

## Step 3: Add X-Wallet-Address Header

Include your wallet address in every RPC request:

```bash
curl -X POST https://rpc.satelink.network/rpc/polygon \
  -H "Content-Type: application/json" \
  -H "X-Wallet-Address: 0xYOUR_WALLET_ADDRESS" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

The `X-Wallet-Address` header bypasses the IP rate limit entirely.  
Calls are debited from your credit balance at $0.00003 USDT per call.

---

## Step 4: Verify Credits

```bash
curl "https://rpc.satelink.network/credits/balance?wallet=0xYOUR_WALLET_ADDRESS"
```

Response:
```json
{
  "ok": true,
  "wallet": "0xyour_wallet_address",
  "balance_usdt": "0.990000",
  "total_deposited": "1.000000",
  "last_deposit_tx": "0xabc..."
}
```

---

## Step 5: Start Making Paid Calls

```python
import requests

ENDPOINT = "https://rpc.satelink.network/rpc/polygon"
WALLET = "0xYOUR_WALLET_ADDRESS"

headers = {
    "Content-Type": "application/json",
    "X-Wallet-Address": WALLET
}

payload = {
    "jsonrpc": "2.0",
    "method": "eth_getBalance",
    "params": ["0xYOUR_WALLET_ADDRESS", "latest"],
    "id": 1
}

response = requests.post(ENDPOINT, json=payload, headers=headers)
print(response.json())
```

---

## Pricing

| Method | Cost (USDT) |
|--------|-------------|
| eth_blockNumber | $0.000001 |
| eth_getBalance | $0.000010 |
| eth_call | $0.000030 |
| eth_getLogs | $0.000050 |
| eth_sendRawTransaction | $0.000100 |

**Minimum deposit:** 1.00 USDT  
**1 USDT ≈ 33,000 standard calls** (eth_call)

---

## Supported Chains

| Chain | Endpoint |
|-------|----------|
| Polygon Mainnet | `/rpc/polygon` |
| Polygon Amoy (testnet) | `/rpc/amoy` |
| Ethereum Mainnet | `/rpc/ethereum` |
| Arbitrum One | `/rpc/arbitrum` |
| Base | `/rpc/base` |

---

## 402 Error: Free Tier Exhausted

If you receive a 402, your IP has hit 500 free calls for the day:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "You've used your 500 free calls today. Deposit 1 USDT to 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3 to continue.",
    "data": {
      "deposit_address": "0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3",
      "network": "Polygon Mainnet (chainId: 137)",
      "resets_in_minutes": 420
    }
  }
}
```

**Fix:** Follow Steps 1–3 above and add `X-Wallet-Address` to all requests.

---

## For Automated Scripts / Vultr Operators

If you're running scripts from a static IP (e.g., Vultr VPS), the free tier resets at midnight UTC. To avoid interruptions:

1. Deposit ≥5 USDT for a month of typical traffic
2. Set `X-Wallet-Address` in your script's default headers
3. Monitor your balance at `/credits/<wallet>`

```bash
# Example: Check balance before running batch job
BALANCE=$(curl -s https://rpc.satelink.network/credits/$WALLET | jq -r '.balance_usdt')
echo "Current balance: $BALANCE USDT"
```

---

## Contracts (Polygon Mainnet)

| Contract | Address |
|----------|---------|
| RevenueVault | `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` |
| USDT (Polygon) | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |

**Explorer:** https://polygonscan.com/address/0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3

---

## Support

- **Docs:** https://docs.satelink.network
- **Status:** https://rpc.satelink.network/api/status
- **Pricing:** https://rpc.satelink.network/api/pricing
