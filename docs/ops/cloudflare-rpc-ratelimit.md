# Cloudflare edge rate-limit for /rpc/* — operator steps

**Why dashboard, not API:** zone `satelink.network` is on the **Free plan**, which caps the
`http_ratelimit` phase at **1 rule** (the API returns `50001: exceeded the maximum number of rules
in the phase http_ratelimit: 2 out of 1`). One rule already exists. The targeted, header-aware
rule below cannot be added via API on Free — apply it in the dashboard (which also gives you the
**Expression Preview** the API lacks), or upgrade to Pro to add it as a 2nd rule.

## HARD RULE (STOP-B): rate-limit, NEVER block
An unauthenticated `/rpc/*` request MUST still receive the app's **402** — that is the x402 payment
challenge, the ONLY paid path. A real x402 client sends 1–2 unauthenticated requests to *discover*
the 402, then retries **with `x-payment`** (excluded below, so never limited). A `Block` custom
rule returns 403 to the FIRST request and kills discovery — do not use one. Use a **Rate Limiting
Rule** (first N/min reach the app, only the overage is blocked).

## Current state
- Existing rule (`satelink-rate-limit`): `(http.host eq "api.satelink.network" or http.host eq
  "rpc.satelink.network") and not starts_with(http.request.uri.path, "/admin/")`, 10 req / 10 s
  per IP, block 10 s. STOP-B-safe but lenient (a 12-request burst was not blocked in testing).
- Verified: unauthenticated `POST /rpc/base` → **402** (app), `/health` → **200**.

## Rule 1 — RATE LIMIT unauthenticated /rpc (primary)
Dashboard → **Security → WAF → Rate limiting rules → Create rule** (Free: you must first free the
existing slot — either replace `satelink-rate-limit` or upgrade to Pro for a 2nd rule).

- **Field / When incoming requests match** — paste into the expression editor (validate in
  Expression Preview first):
  ```
  (http.request.uri.path contains "/rpc/")
  and not (any(http.request.headers.names[*] eq "x-wallet-address"))
  and not (any(http.request.headers.names[*] eq "x-api-key"))
  and not (any(http.request.headers.names[*] eq "x-payment"))
  and not (http.request.uri.path contains "/internal/")
  and not (http.request.uri.path eq "/health")
  ```
- **Rate:** 5 requests / **1 minute**, **Count by** IP.
- **Action:** Block (this is a rate-limit action — only the overage past 5/min is blocked).
- **Duration:** 10 minutes.
- **If `http.request.headers.names` is unavailable on the plan (Expression Preview errors):**
  fall back to a PATH-ONLY rate limit — expression `(http.request.uri.path contains "/rpc/") and
  not (http.request.uri.path contains "/internal/") and not (http.request.uri.path eq "/health")`,
  Rate 20 req / 1 min per IP (higher, since authenticated paying clients are NOT excluded and must
  not be throttled). Do NOT silently ship a different rule — note the fallback explicitly.

## Rule 2 — BLOCK obvious scanners (Custom rule, safe: never matches a real x402 client)
Dashboard → **Security → WAF → Custom rules → Create rule**. Free allows 5 custom rules.
```
(http.request.uri.path contains "/rpc/")
and not (http.request.uri.path contains "/internal/")
and not (http.request.uri.path eq "/health")
and not (any(http.request.headers.names[*] eq "x-payment"))
and (
      http.user_agent eq ""
   or not (http.request.method in {"POST" "OPTIONS"})
   or http.user_agent contains "zgrab"
   or http.user_agent contains "masscan"
   or http.user_agent contains "Nuclei"
   or http.user_agent contains "python-requests"
)
```
- **Action:** Block. Safe because a genuine x402 client always sends a non-empty UA and POSTs —
  it never matches, so it still reaches the app 402. Empty-UA / GET / known-scanner UAs do not.

## Rule 3 — protect the paid + ops paths (put FIRST, action Skip)
Ensure nothing ever touches `/health`, `/internal/*`, or a request carrying `x-payment`:
```
(http.request.uri.path eq "/health")
or (http.request.uri.path contains "/internal/")
or (any(http.request.headers.names[*] eq "x-payment"))
```
- **Action:** Skip → skip remaining custom rules + rate limiting rules. Guarantees x402 retries
  (with `x-payment`) and health/internal are never rate-limited or blocked.

## Post-apply verification (run from outside the network)
```
# a) x402 discovery intact — expect 402 (app), NOT 403 (CF)
curl -sS -o /dev/null -w 'unauth=%{http_code}\n' -X POST https://api.satelink.network/rpc/base \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}'
# b) burst of 12 → first ~5 → 402, remainder → 429/403 (CF)
for i in $(seq 1 12); do curl -sS -o /dev/null -w "$i=%{http_code} " -X POST \
  https://api.satelink.network/rpc/base -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}'; done; echo
# c) health untouched → 200
curl -sS -o /dev/null -w 'health=%{http_code}\n' https://api.satelink.network/health
# d) x-payment retry never limited → 402/app, never 429
curl -sS -o /dev/null -w 'xpay=%{http_code}\n' -X POST https://api.satelink.network/rpc/base \
  -H 'content-type: application/json' -H 'x-payment: test' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}'
```
If (a) ever returns 403, STOP-B is violated — delete the rule immediately.
