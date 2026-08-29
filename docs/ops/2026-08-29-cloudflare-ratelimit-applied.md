# Cloudflare /rpc rate-limit — applied 2026-08-29

Edited the single Free-plan `http_ratelimit` rule (`satelink-rate-limit`,
id `9c3b6ada45a24a54a954c89b35d61243`) on zone `satelink.network`. Rollback artifact:
`docs/ops/cloudflare-rollback-2026-08-28.json` (the pre-change ruleset, restore with a PATCH).

## What changed

| | Before | After |
|---|---|---|
| expression | `(http.host eq api/rpc) and not starts_with(path,"/admin/")` | `(http.host eq api/rpc) and http.request.uri.path contains "/rpc/"` |
| scope | **every path** on api/rpc (incl. `/health`, `/internal`, payment retries) | **`/rpc/` paths only** |
| requests_per_period | 10 | 20 |
| period | 10 s | 10 s (Free-locked) |
| mitigation_timeout | 10 s | 10 s (Free-locked) |
| action / characteristics | block / `[cf.colo.id, ip.src]` | unchanged |

Net: `/health`, `/internal/*`, `/admin/` are **no longer counted** (they were being
throttled — see before-verification 2.4), and the `/rpc` allowance loosens to ~120/min per IP.

## KNOWN LIMITATION — header exclusion is impossible on Free (proven)

The ideal rule excludes paying traffic from the counter:
`... and not any(http.request.headers.names[*] eq "x-payment"/"x-api-key"/"x-wallet-address")`.
The Cloudflare API **rejected** it verbatim:

```
not entitled: the use of field http.request.headers.names is not allowed,
an higher Advanced Rate Limiting plan is required
```

So on Free the counter **cannot distinguish paid from unpaid `/rpc` traffic**. Consequence:
if an IP floods `/rpc` past 20/10 s and enters mitigation, `x-payment` requests from *that same
IP* are also blocked for the 10 s window. This is acceptable because a single paying x402 client
does not burst 20 requests in 10 s — that volume is scanner-shaped regardless of headers. A
single, non-bursted `x-payment` request is **not** throttled (verified below). Fixing this
properly needs Business/Enterprise (Advanced Rate Limiting); not worth it for ~$1.88/mo egress.

## Verification (raw, from outside the network)

| check | before | after |
|---|---|---|
| 2.1 single unauth `POST /rpc/base` | 402 | **402** (app, not CF 403) ✅ |
| 2.2 burst of 15/25 | 10×402 then 429 (all paths) | first ~20→402, then 429 (edge) ✅ |
| 2.3 **single** `x-payment` (non-bursted) | 429 (collateral of prior burst) | **400** — reached app, NOT throttled ✅ |
| 2.3b `x-payment` *inside* a 25-burst | — | 429 (known limitation, not a revert trigger) |
| 2.4 `/health` | 429 (throttled!) | **200** ✅ (no longer counted) |
| 2.5 reconciler `/readyz` (outside zone) | 200 | **200** `{"db":"ok"}` ✅ |
| GitHub health-check workflow | pass | **pass** (run 33233440846, unaffected) ✅ |

Per-IP confirmed by config (`characteristics: [cf.colo.id, ip.src]`) and by `/health` staying
200 from the same IP during the `/rpc` block (not a global block). A second-egress-IP burst was
not feasible from the single-source ops environment.

## Egress baseline (re-check in 24 h)
- Dashboard cumulative: **37.69 GB total, ~2 GB/day, $1.88** — recorded **2026-08-29T04:18Z**.
- If egress does not fall meaningfully by 2026-08-30, the rule is not the lever and should be
  reverted rather than left as unexplained config (restore from the snapshot).

## Rollback
```
PATCH /zones/{zone}/rulesets/588535587915434b96654a5c243aa4d0/rules/9c3b6ada45a24a54a954c89b35d61243
  body = the single rule from docs/ops/cloudflare-rollback-2026-08-28.json
```
