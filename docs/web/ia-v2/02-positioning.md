# 02 — Positioning & Messaging

**Satelink — Machine Commerce Infrastructure.** Infrastructure that lets software
agents, machines, developers, and businesses discover, access, pay for, and
settle machine-native services. (§3)

## Message hierarchy
1. **One-liner (H1 / hero):** "Machine Commerce Infrastructure" + a ≤50-word
   answer-first definition (the GEO entity block, reused verbatim in JSON-LD and
   `llms.txt`).
2. **Three value pillars:** Discover services · Pay per use · Settle transparently.
3. **Two audiences framing everywhere:** machine buyers (agents that discover,
   pay, consume) and machine sellers (APIs that price, meter, get paid).

## Voice
Plain English first, then technical detail. No hype, no market-size claims, no
superlatives that can't be verified. Every promissory phrase about returns/
profit/guarantees is banned by truth-lint (`19-validation-suite.md`).

## Canonical concept URLs (§3) — one explanation each; everywhere else links here
Encoded in `@satelink/content` → `CANONICAL_URL`:

| Concept | URL |
| --- | --- |
| Machine Commerce | `/products/machine-commerce` |
| Trading Intelligence | `/products/trading-intelligence` |
| x402 | `/products/x402` |
| RPC | `/products/rpc` |
| API Metering / Credits | `/products/metering` |
| API | `/platform/api` |
| Pricing | `/pricing` |
| Enterprise | `/solutions/enterprise` |

`/product/overview` = platform-wide overview. `/solutions/machine-commerce` is
the use-case page; it links to `/products/machine-commerce` for the definition.

## Compliance framing (§2 — the Dodo reviewer will read the site)
- Trading Intelligence = **SaaS analytics**: derived statistics from public
  market data. Not investment advice. No custody. No signals/execution/returns.
- RPC / x402 / USDT / settlement / machine wallets / nodes = **crypto-native
  machine rail — not billed through Dodo.** No Dodo button/logo on those pages.
