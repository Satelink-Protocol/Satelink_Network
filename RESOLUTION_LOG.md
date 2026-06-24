# RESOLUTION LOG
# Append-only. One entry per resolved issue.

---

## SAT-240 — Smoke test end-to-end deposit flow with real USDT on Polygon Mainnet
**Resolved:** 2026-06-05
**Resolver:** ENGINEERING_COMMANDER

### Result: PASS — All 6 steps verified on Polygon Mainnet

| Step | Action | Result |
|------|--------|--------|
| 1 | `GET /credits/deposit/initiate?amount=1` | 200 — returned approveCalldata + depositCalldata |
| 2 | Submit USDT approve tx to RevenueVault on Polygon Mainnet | Confirmed on-chain |
| 3 | Submit deposit tx to RevenueVault | Tx: `0xd188cc0b248e94319d0012ef83a89f7a258d2dcf8a3cf11c3ec3ab68fa83fb71` (block 87932563) |
| 4 | `GET /credits/balance` with X-Wallet-Address header | balance > 0 — DepositListener credited within 1s |
| 5 | RPC call via `POST /rpc/polygon` with X-Wallet-Address | Executed successfully |
| 6 | Re-check `/credits/balance` | Credit deducted at 0.00001 USDT/call — billing confirmed working |

### Contract
- RevenueVault: `0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3` (Polygon Mainnet 137)
- USDT: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`
- Polygonscan: https://polygonscan.com/address/0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3

### Impact
- EVT-REV-002 marked RESOLVED in ACTIVE_EVENTS.md
- CLAUDE.md Section 3 updated: RevenueVault row → VERIFIED
- CLAUDE.md Section 5: deposit flow smoke test marked DONE
- Billing rate: $0.00001 USDT/call confirmed deducting correctly
- DepositListener: credits within 1s of on-chain deposit confirmation

### Next action
Recruit Customer Zero. The flow works end-to-end — register first external paying customer.
See EVT-CUST-001.
