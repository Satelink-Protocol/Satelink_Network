# Satelink Traffic Intelligence Report

**Generated:** 2026-06-14
**Data snapshot:** live `GET https://rpc.satelink.network/system/free-tier`
**Headline numbers:** 2,204 active IPs · 354,314 calls today · **$0.00 collected**

---

## TL;DR

- **77.6% of all traffic comes from 6 IPs** making >5,000 calls/day. These are
  unambiguous automated crawlers. As of PR #127 they are hard-blocked at the **429
  abuse tier** instead of consuming Redis quota real users need.
- **91.7% of all calls come from just 55 IPs** (>500/day). The network does not have
  thousands of active customers — it has a few dozen heavy automated clients plus a
  long tail of ~2,149 low-volume IPs averaging **13.7 calls/day each**.
- **We cannot yet tell developers from bots.** The only signal currently captured per
  request is a **per-IP daily counter**. Method, timing, and User-Agent are stored
  *nowhere*. Volume alone confidently identifies *crawlers* but cannot identify
  *developers* — the people who can actually pay.
- **The fix ships in this PR:** capture the User-Agent (a software identifier, not PII)
  on the free-tier gate. That single field will classify ~80% of traffic automatically
  going forward (`curl`/`python` = script, `ethers.js`/`viem` = developer, `Mozilla` =
  browser).

---

## Classification Framework Used

The brief proposed four signals. Here is what each is actually worth **today**:

| Signal | Intended use | Status in production |
|--------|--------------|----------------------|
| **Call volume** (per IP) | Crawlers spike to extreme counts | ✅ **Available** — Redis `ft:<ip>` counters |
| **Method diversity** | 1 method = bot, many = developer | ❌ **Not captured** — gate stores no method |
| **Timing variance** | Uniform = bot, bursty = human | ❌ **Not captured** — gate stores no timestamps |
| **User-Agent** | `curl`=script, `ethers`=dev, browser=human | ❌ **Not captured** — *added in this PR* |

### Why methods/timing could not be analyzed

The original plan was to query `revenue_events_v2` for per-method and per-hour
distributions. Two hard blockers, both verified:

1. **The production Postgres is unreachable from outside Railway.** `DATABASE_URL`
   resolves to the internal host `paperclip-db.railway.internal`, which only exists
   inside Railway's private network. Confirmed by three failed paths:
   - local `127.0.0.1:5432` → `ECONNREFUSED` (no local PG; local dev is broken per CLAUDE.md)
   - `railway run node …` → `getaddrinfo ENOTFOUND paperclip-db.railway.internal`
   - no `DATABASE_PUBLIC_URL` / proxy variable exists in the service
2. **Even if reachable, `revenue_events_v2` is the wrong table.** It logs only *billed*
   RPC executions (~7,918 rows/24h — see `/api/status`), which is **<2.5%** of the
   354,314 free-tier calls we need to classify. The other 97.5% of traffic never
   reaches a table; it lives only as opaque `ft:<ip>` integer counters in Redis.

**Conclusion:** method/timing analysis is impossible with today's instrumentation, and
would be unrepresentative even if the DB were reachable. Volume is the only real signal,
and it is enough to isolate crawlers but not to find developers. That gap is the whole
reason to ship User-Agent capture.

---

## Traffic Classification Summary

Volume-only classification of the live snapshot (354,314 calls across 2,204 IPs):

| Type | Est. % of calls | IP Count | Revenue Potential |
|------|-----------------|----------|-------------------|
| Automated crawlers (>5,000/day) | **77.6%** (275,074) | 6 | None — now 429 abuse tier |
| Heavy bots (1,001–5,000/day) | 8.6% (30,320) | 17 | Very low |
| Over-limit power users (501–1,000/day) | 5.5% (19,542) | 32 | Low–Medium — *unknown without UA* |
| Under-limit long tail (≤500/day) | 8.3% (29,378) | ~2,149 | **UNKNOWN** — real devs hide here, but indistinguishable from light bots today |

> The "power users" and "long tail" rows are where any paying customer would be — but
> with only a volume signal, an honest analyst cannot separate a dApp backend doing 600
> calls/day from a price-scraping bot doing 600 calls/day. **They look identical until we
> have User-Agent.**

### Full over-limit distribution (the 55 IPs = 91.7% of traffic)

```
  >5,000 (abuse) :   6 IPs    275,074 calls   (77.6% of ALL traffic)
  2,001–5,000    :   4 IPs     12,196 calls
  1,001–2,000    :  13 IPs     18,124 calls
  501–1,000      :  32 IPs     19,542 calls
  ----------------------------------------------
  Remaining      : 2,149 IPs    29,378 calls   (avg 13.7 calls/IP)
```

---

## Top 10 Confirmed Crawlers

Evidence: extreme volume (hundreds to tens of thousands of × the 500/day limit). No
legitimate single client needs this many calls. These ignore the 402 and retry — exactly
the behavior the new 429 abuse tier (>5,000/day) was built to stop.

| # | client_id (hashed) | calls/day | × limit | Status |
|---|--------------------|-----------|---------|--------|
| 1 | IP-02022e2b32fd | 118,402 | 236× | 🤖 429 abuse-blocked |
| 2 | IP-bf559ae91327 | 90,283 | 180× | 🤖 429 abuse-blocked |
| 3 | IP-61c66661c26f | 35,221 | 70× | 🤖 429 abuse-blocked |
| 4 | IP-6d8d739fc775 | 14,890 | 30× | 🤖 429 abuse-blocked |
| 5 | IP-add3f3918817 | 10,753 | 22× | 🤖 429 abuse-blocked |
| 6 | IP-05f979ba002a | 5,525 | 11× | 🤖 429 abuse-blocked |
| 7 | IP-c9986c790bb7 | 4,035 | 8× | ⚠️ 402 (just under abuse line) |
| 8 | IP-e2ddc5c3acdc | 3,307 | 7× | ⚠️ 402 |
| 9 | IP-bdcb35ca35be | 2,765 | 6× | ⚠️ 402 |
| 10 | IP-4a136d1837f9 | 2,089 | 4× | ⚠️ 402 |

**Action:** already mitigated. Rows 1–6 hit the 429 abuse tier today; rows 7–10 will
cross it if they keep climbing. No revenue is lost — these never intended to pay.

---

## Top 10 Most Likely Developer / dApp Candidates

**Honest caveat:** with volume as the only signal, this list is a *best guess*, not a
classification. The strongest available proxy is the **"power user" band** — IPs using
the service enough to bump the limit (real value) but **not** at crawler scale. These are
the IPs most worth converting *if* they turn out to be developers. We will only know once
User-Agent capture (this PR) lands.

| # | client_id (hashed) | calls/day | Why a candidate |
|---|--------------------|-----------|-----------------|
| 1 | IP-c0c7d02f051f | 1,886 | Steady moderate volume, well below crawler scale |
| 2 | IP-2b9d551f1799 | 1,782 | " |
| 3 | IP-7226567e1537 | 1,755 | " |
| 4 | IP-ab4f13924f99 | 1,531 | " |
| 5 | IP-37075b3be5ff | 1,410 | " |
| 6 | IP-77a446d4b0b9 | 1,287 | Sustained daily use, plausible app backend |
| 7 | IP-399c311e86ce | 1,257 | " |
| 8 | IP-a1aecc770353 | 1,158 | " |
| 9 | IP-400b05af1d45 | 1,029 | Just over 2× limit — classic "needs a paid plan" cohort |
| 10 | the 56 near-limit IPs (400–500/day) | <500 | Hitting the ceiling without abusing it — best conversion profile |

**Action:** treat as Customer Zero candidates, but **do not invest in outreach until UA
data confirms they are developers.** Targeting these blind is guesswork.

---

## What Data Would Improve Classification

1. **User-Agent header** *(shipping in this PR)* — single highest-value field. Separates
   `curl`/`wget`/`python` (scripts) from `ethers.js`/`viem`/`web3` (developers) from
   browsers. Stored alongside the hashed `client_id`, never with the raw IP.
2. **Chain being called** (`/rpc/polygon` vs `/rpc/ethereum` vs `/rpc/base`) — intent
   differs by chain; a Polygon-only caller vs a multi-chain caller signals different use.
3. **RPC method** (`eth_call` vs `eth_getLogs` vs `eth_getBalance`) — method mix
   distinguishes a monitoring bot (one method, looped) from a dApp (diverse methods).
4. **Referer / Origin header** — for browser-originated traffic, reveals which dApp or
   site is routing calls through Satelink.

---

## Single Highest-ROI Action

**Ship User-Agent capture (this PR) and re-run this report in 24h.**

Everything else is blocked on it. Right now **92% of traffic is "unknown"** and any
revenue targeting is guesswork. One header turns the daily `conversion_targets` export
from a list of anonymous volume counts into a classified list of *curl vs ethers vs
browser* — at which point "find Customer Zero" becomes a filter, not a guess.

The abuse tier (PR #127) already stopped the bleeding (6 crawlers = 78% of load no longer
waste quota). The next dollar of revenue depends on **identifying** the real developers in
the long tail, which is precisely what this field enables.

---

## Honest Revenue Estimate

**Near-term (today's traffic, no new instrumentation): ~$0.**
The traffic that *can* be measured is overwhelmingly automated (78% from 6 crawlers). The
long tail that *might* contain developers is unmeasurable and uncontactable (hashed IPs,
no User-Agent, no API-key linkage).

**After UA capture + 24h of data — illustrative, not a forecast:**
Suppose the ~2,149 long-tail + 32 power-user IPs resolve to, say, **2% genuine
developers** (~44 IPs) once classified, and **10% of those** deposit a minimum $1 USDT
after hitting the limit:

```
  44 developer IPs × 10% conversion × $1 USDT  ≈  $4–5 USDT
```

That is a **rounding error, and entirely hypothetical** — it assumes a conversion path
(auto-provisioned API key on deposit, per CLAUDE.md §5.3) that is **not yet wired**.

**The honest read:** current traffic is not a revenue pipeline; it is mostly crawlers
plus an unidentified long tail. The path to the first real dollar is:
1. ✅ Block crawlers (PR #127 — done)
2. ⏳ **Identify developers (this PR — User-Agent capture)**
3. ⏳ Wire API-key provisioning into the deposit flow (open, CLAUDE.md §5.3)
4. ⏳ Land Chainlist PR #8314 for real organic developer traffic (pending @ligi)

Without step 2, steps 3–4 have no one to convert.

---

*Method note: all volume figures are from a single live snapshot of
`/system/free-tier`; counts drift upward through the UTC day and reset at midnight UTC.
No raw IPs were accessed — `client_id` values are salted SHA-256 hashes.*
