# Conversion Targets Report

**Generated:** 2026-06-02T06:31:00.000Z (SAT-180 daily heartbeat)
**API:** https://rpc.satelink.network/system/free-tier

## Summary

- **Date:** 2026-06-02
- **Active IPs today:** 495
- **Total RPC calls today:** 290,462
- **IPs near limit (≥90% of 500 calls):** 23
- **IPs at limit (100%):** 0 (not separately reported by API)
- **Daily free tier limit:** 500 calls

## Trend vs Yesterday (2026-06-01)

| Metric | Yesterday | Today | Delta |
|---|---|---|---|
| Active IPs | 290 | 495 | **+205 (+71%)** |
| Near-limit IPs | 14 | 23 | **+9 (+64%)** |
| Conversion targets (≥90%) | 0 | 23 (near-limit) | **+23** |

> **Significant growth detected.** Active IPs nearly doubled overnight. Near-limit count
> rose from 14 → 23. No IPs confirmed at 100% limit (API does not separate this tier).

## Next Steps

1. **Exceeded users**: Send 402 response with deposit instructions (automatic)
2. **Critical (95%+)**: Proactive outreach before they hit limit
3. **High (90-95%)**: Include in weekly conversion campaign

## How to Convert

Users can upgrade by:
1. Depositing USDT to RevenueVault on Polygon Mainnet
2. Adding `X-Wallet-Address` header to RPC requests
3. Cost: $0.00003 per RPC call, minimum deposit $1.00
