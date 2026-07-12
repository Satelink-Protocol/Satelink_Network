# CDP x402 Bazaar — Escalation

**Status:** ready to send · **Drafted:** 2026-07-12

**Where to post:** Comment on [`x402-foundation/x402#2112`](https://github.com/x402-foundation/x402/issues/2112)
(same root cause), or file with Coinbase CDP support.
**Redact the CDP account/project ID if posting publicly** — include it only in a private CDP ticket.

All four settlement tx hashes below were verified on Base mainnet before drafting
(`eth_getTransactionReceipt` → `status: 0x1`, `to:` USDC, `transferWithAuthorization`).

---

**Title:** Settled x402 resource frozen in `discovery/merchant`, absent from `discovery/search`, and stale after subsequent settlements

## Summary

A correctly-configured x402 v2 resource settles successfully through the CDP facilitator
and *does* appear in `GET /platform/v2/x402/discovery/merchant?payTo=…`, but the catalog
entry (a) is **never updated by subsequent settlements** (URL, price, and `lastUpdated` are
frozen at the first settlement), (b) was indexed as an **uncallable wildcard template**
rather than the declared concrete resource, and (c) **does not appear in `/discovery/search`**
at all. This overlaps #2112. Four on-chain-verified mainnet settlements to reproduce from.

## Setup (all correct per docs)

| Field | Value |
|---|---|
| Facilitator | `https://api.cdp.coinbase.com/platform/v2/x402` |
| Network | `eip155:8453` (Base) |
| Asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| payTo (merchant) | `0x966E1Ae22996545015b1414B35234b10719d7Ad4` (external EOA) |
| Declared resource | `https://rpc.satelink.network/rpc/polygon` |
| Discovery | `bazaarResourceServerExtension` registered + `declareDiscoveryExtension()` on the route, validated locally |
| CDP account/project ID | `<REDACT for public; include in private ticket>` |

## Settlements (verified on Base mainnet — `status: success`, `to:` USDC, `transferWithAuthorization`)

| Settlement tx | Block | Amount | Time (UTC) |
|---|---|---|---|
| `0x93c88609d6c81fe498ca294caccc94af5f0446882af41a8783a57b863c8178d1` | 48425154 | $0.001 | 2026-07-09 23:27 |
| `0x6a466e54ba663f3fad469b68fcde5ac8692f8da9be4f70cbcf3d4fe451bd965b` | 48426058 | $0.001 | 2026-07-09 23:57 |
| `0x1f08e12aefc7577d293e18da16b8f5e834f6560b4b3885957f26602acd6cf6cf` | 48467412 | $0.10 | 2026-07-10 22:56 |
| `0x0e0a72d430278782aa6b1415152d0b7fddc43d9423669032edf522ad9ec7a4f3` | 48468033 | $0.10 | 2026-07-10 23:16 |

## What the catalog shows now

`GET /platform/v2/x402/discovery/merchant?payTo=0x966E1Ae2…` returns:

```
total: 1
resource:            https://rpc.satelink.network/rpc/:var1   ← literal unsubstituted template, not callable
accepts[0].amount:   "1000"  ($0.001)
lastUpdated:         2026-07-09T23:57:42Z
```

### Bug 1 — the entry is never updated by subsequent settlements

The two 2026-07-10 settlements ($0.10 each) landed **~4 hours after** we changed the route
declaration to a concrete `/rpc/polygon` resource and the price to $0.10. Yet `resource` is
still `/rpc/:var1`, `amount` is still `1000` ($0.001), and `lastUpdated` is still
`2026-07-09T23:57:42`. Subsequent settlements do not refresh the cataloged resource, price,
or timestamp.

### Bug 2 — the resource was indexed as an uncallable wildcard template

The original route matched `POST /rpc/*`; it was cataloged as
`https://rpc.satelink.network/rpc/:var1` with empty `pathParams`. An agent has no way to
resolve `:var1` → the discovered URL is not directly callable.

### Bug 3 — the resource is absent from `/discovery/search`

`GET /platform/v2/x402/discovery/search?query=…` returns **0 results for every query we
tried** (`"satelink"`, `"polygon rpc"`, `"rpc"`) — and also 0 for queries that should match
other clearly-indexed merchants (e.g. `"email"` for a prominent email service present in
`/discovery/resources`). Is `/discovery/search` deprecated/broken, or does it require
different parameters/auth? If agents discover via search, a resource that appears only in
`merchant?payTo=` is effectively invisible.

## Questions (ref #2112)

1. What event **updates or re-indexes an existing** merchant resource? Subsequent settlements
   clearly don't. Is there an API/dashboard action to refresh or **evict** a stale entry?
2. Is the documented `EXTENSION-RESPONSES` diagnostic header actually emitted on settle
   responses? We (like #2112) never observe it — what should a successful cataloging settle
   response contain?
3. Is `/discovery/search` the intended agent-discovery surface, and why does it return empty
   for all queries?
4. Are **external-EOA** payees fully supported for discovery/search (ours indexes into
   `merchant` but not `search`) — or is a CDP-managed wallet required to be search-visible?

## Ask

Please re-index or evict the stale `/rpc/:var1` entry for payTo `0x966E1Ae2…` so our current
declaration (`/rpc/polygon`) catalogs correctly, and advise the supported mechanism for
keeping a resource fresh. Happy to provide the CDP project ID and additional settlements
privately.
