# SATELINK REVENUE MODEL — AGENT REFERENCE

## THE MONEY PATH (exact flow)

1. Machine/developer sends RPC calls to https://rpc.satelink.network
2. freeTierGate middleware checks: is this IP/wallet in free tier?
3. Free tier: 500 calls/day per IP — no USDT required
4. Paid tier: caller deposits USDT → gets credits → credits deducted per call
5. Every 60 seconds: epoch closes → earnings aggregated
6. Node operators: 50% of revenue generated through their node
7. Platform: 30% fee + 20% distribution pool
8. Settlement: USDT on Polygon PoS via RevenueVault contract

## CURRENT STATE (update when values change)

| Metric | Value | Status |
|--------|-------|--------|
| Free tier limit | 500 calls/day | ACTIVE |
| Near-limit IPs | 62+ | UNCONVERTED |
| Paying wallets | 0 | ZERO |
| Collected USDT 24h | $0 | ZERO |
| BILLING_ENABLED | verify | UNKNOWN |
| RevenueVault | deployed | Polygon |

## CONVERSION MATH

62 IPs near limit × $10/month average = $620/month if converted = $0.86/hr
62 IPs × $50/month = $3,100/month = $4.30/hr
$500/hr = $360,000/month → requires ~7,200 paying machines at $50/month
Near-term: first 5 paying machines = $250/month = $0.35/hr (proof of concept)
Medium-term: 100 machines = $5,000/month = $6.94/hr

## COMPETITOR PRICING (reference)

| Provider | Price | Calls |
|----------|-------|-------|
| Alchemy | $49/mo | 300M CU |
| Infura | $50/mo | 100K calls/day |
| QuickNode | $49/mo | 10M credits/month |
| dRPC | pay-per-call | $0.00003/call |
| Satelink | TBD | 500 free then ? |

Gap: Satelink needs a PAYG option for machines that won't commit to subscription.

## REVENUE SEVERITY

REV-1: BILLING_ENABLED=false | treasury mismatch | payment path broken | zero USDT 3+ days
REV-2: Conversion path broken | pricing blocks adoption | PAYG option missing
REV-3: Funnel degradation | wallet activation slow
REV-4: Analytics gap | dashboard mismatch
