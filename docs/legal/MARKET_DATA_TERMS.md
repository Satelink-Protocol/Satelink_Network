# Market-data terms — Binance, Bybit, OKX, Hyperliquid

> **For legal review — not legal advice.** Prepared 2026-09-28 for Jakuraa Commercial Pvt Ltd (India) — product
> "Satelink Trading Intelligence" ($0.01/call, sold worldwide; derived metrics from public exchange endpoints; labelled
> NOT INVESTMENT ADVICE; refresh worker on Railway `us-west2`).
> Method: official pages/PDFs fetched 2026-09-28 (mostly from an Indian IP). Quotes are verbatim; anything not confirmed is
> marked **not found**, **ambiguous** or **could not fetch**. OKX §1.8/§9.4 quotes were independently re-verified.
> **Production today** (`apps/api/src/intelligence/connectors.js`): the refresh calls `fapi.binance.com`, `api.bybit.com`,
> `www.okx.com` and `api.hyperliquid.xyz`.

## 1. Binance
Sources: Terms of Use https://www.binance.com/en/terms (renders PDF https://bin.bnbstatic.com/static/cms/cg08ou2ak0tn7mcplvfg/file/bf4879710c904b991848972ec4818ba2cf9e4ce314c09adae84fa2750d3477f7.pdf, **effective 21 July 2026**, ADGM "Nest" entities, version served to an Indian IP) ·
Prohibited Countries https://www.binance.com/en/about-legal/list-of-prohibited-countries (**updated 5 January 2026**) ·
API "Terms of Use" https://developers.binance.com/docs/binance-spot-api-docs/PROD-TERMS-OF-USE (**25 Sep 2026**, points to the product terms) ·
rate limits https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md (undated).
1. **Commercial use — restricted.** Cl. 27 licenses Binance IP "solely as necessary to allow you to receive the Binance Services for non-commercial personal or internal business use." Whether public market data is "Binance IP" is **ambiguous**.
2. **Redistribution — not explicit in the current PDF (not found).** A clause attributed by search engines to binance.com/en/terms ("Without written consent from Binance, the following commercial uses of Binance data are prohibited" — incl. "data feeding or streaming services" and services that "charge for or otherwise profit from … market data obtained from Binance") was **not found** in the version served 2026-09-28; likely another regional/earlier version → counsel to obtain the version that applies.
3. **Attribution** — not found.
4. **US / India** — Prohibited Countries bars anyone "(i) located, incorporated, otherwise established in, resident of, a citizen of, or operating in: United States". Cl. 25.5: "You must not attempt in any way to circumvent any such restriction, including by use of any virtual private network to modify your internet protocol address." Coverage of unauthenticated market-data calls: **ambiguous**. India: same ADGM PDF; no India-specific data terms found.
5. **Automated access** — "Repeatedly violating rate limits and/or failing to back off after receiving 429s will result in an automated IP ban (HTTP status 418)", from 2 minutes to 3 days.

## 2. Bybit
Sources: API Terms https://www.bybit.com/en/legal/service-specific-terms/API-Terms (**2026-01-16**) · Platform T&C https://www.bybit.com/en/legal/terms-of-service/Bybit-BTL-Platform-Terms-and-Conditions (**2026-09-02**) · Restricted Countries https://www.bybit.com/en/help-center/article/Service-Restricted-Countries (**2026-09-01**) · India addendum https://www.bybit.com/en/legal/terms-of-service/Addendum-to-Terms-of-Service-India-Users (**2026-06-25**) · rate limits https://bybit-exchange.github.io/docs/v5/rate-limit.
1. **Commercial use — prohibited.** API 6.9: "You or your API Client shall not commercially exploit the APIs." Platform 6.4(e) bars "any commercial use of the Site or Platform".
2. **Raw** — API 6.7: shall not "repackage or resell the services, or any part thereof, API or Service Data" ("Service Data" = "any data, or information within the dataset and content that is given by using the API"). **Derived** — Platform 6.4(a) bars "create derivative works of the Site or Platform, or any data or content"; API 6.5 bars attempts to "compete with or replace the user experience of our products and services". Indemnity 9.1(d) mentions "any derived analyses or applications which you have provided" — contemplates, does not grant: **ambiguous**.
3. **Attribution** — not found (6.4(b) bars removing notices).
4. **US / India** — Platform 11.3 lists the "United States" as an Excluded Jurisdiction; "information and services provided by the Platform are not provided to, and may not be used by or for the benefit of" such persons. Public-endpoint coverage: **ambiguous**. India users contract with Bybit Technology Limited (addendum).
5. **Automated access** — bars "robot, spider … 'data mine', 'scrape', 'harvest'"; API 6.6 bars benchmarking; "600 requests within a 5-second window per IP".

## 3. OKX (most explicit)
Sources: API Agreement https://www.okx.com/help/okx-api-agreement (**28 July 2026**, re-verified) · ToS https://www.okx.com/help/terms-of-service (**17 September 2026**) · Risk & Compliance Disclosure https://www.okx.com/help/risk-compliance-disclosure (**8 July 2026**).
- §1.8 "Market Data" includes "funding rate, index, volatility surface, open interest … whether accessed with or without authentication" — Satelink's inputs.
1. **Commercial use — licence required.** ToS 9.4: "You may not use the OKX Platform or the Services for any commercial purpose unless otherwise explicitly authorized by OKX." API 9.4: "solely for your own personal, non-commercial trading and account management purposes."
2. **Raw** — 9.4(a): may not "resell, redistribute, publish, display, or otherwise make Market Data available to any third party … without OKX's prior written consent". **Derived** — 9.4(b): may not "use Market Data to build, operate, or contribute to any competing data product, market data service, financial data aggregator, price feed, or analytics platform". **Public endpoints** — "The restrictions in this Section 9.4 apply equally to Market Data accessed through public endpoints as to Market Data accessed through authenticated endpoints."
3. **Attribution** — not found; 9.5 bars removing notices / using marks.
4. **US / India** — Restricted Locations include **"India"** and "certain jurisdictions within the United States of America". An Indian company may be a restricted user regardless of worker region.
5. **Automated access** — commercial/large-scale users "must obtain a separate data licensing agreement with OKX". No licensing address found (Help Center form).

## 4. Hyperliquid
Sources: Terms https://app.hyperliquid.xyz/terms (**June 15, 2026**, Hyperliquid Corp; governs the "Interface" at app.hyperliquid.xyz) · https://hyperliquid.xyz/terms **could not fetch** (403) · rate limits https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits.
1–3. Commercial use / redistribution / attribution — **not found**; whether the Interface terms cover `api.hyperliquid.xyz` is **ambiguous**; underlying data is public L1 state.
4. **US** — 1.6 Restricted Persons include those who "reside in, are located in, are incorporated in, or have a registered office in the United States of America or Ontario, Canada"; 3.1.5 bars VPNs/proxies to conceal location. India not mentioned.
5. "REST requests share an aggregated weight limit of 1200 per minute" per IP; 3.1.8 bars bots that "bypass rate limits".

## Matrix
| Venue | Commercial use | Raw redistribution | Derived redistribution | US restriction | Licence route |
|---|---|---|---|---|---|
| Binance | Restricted (non-commercial / internal) | Not explicit now; legacy clause bars data feeds (verify) | Ambiguous | Yes; VPN evasion barred | not found ("written consent" in legacy text) |
| Bybit | Prohibited | Prohibited | Prohibited as written (9.1(d) ambiguity) | Yes | not found |
| OKX | Licence required | Prohibited w/o written consent | **Prohibited — "financial data aggregator … analytics platform"**; public endpoints covered | Partial US; **India restricted** | "separate data licensing agreement" |
| Hyperliquid | Not addressed | Not addressed | Not addressed | Yes (Interface); API scope ambiguous | none found |

## Risk reading (non-lawyer, engineering)
1. **OKX: clear conflict without a licence** — aggregator/analytics named, public endpoints covered, funding rate + open interest named. Production uses OKX today.
2. **Bybit: conflict as written** (repackage/resell, derivative works, commercial exploitation).
3. **Binance: likely conflict** (non-commercial/internal licence; legacy data-feed clause if applicable).
4. **Geo-blocks:** Binance/Bybit exclude US-located users and bar IP/VPN evasion. Routing around the block through non-US proxies would be the prohibited circumvention — **do not**. Moving the worker region (FG-TI-REGION) does **not** fix licensing.
5. **OKX lists India as restricted** → Jakuraa may be a restricted user whatever the worker region.
6. **Hyperliquid is the lowest-risk input** (terms silent on data; on-chain state), but Interface terms exclude US persons; running an own non-validator node would reduce reliance on its API terms (not confirmed).
7. The NOT INVESTMENT ADVICE label does not cure licensing. Exposure: termination, IP bans, broad indemnities (Bybit 9.1, OKX 11.4), possibly IP/database rights.

## Questions for counsel
1. Which Binance terms bind a non-account holder calling public endpoints? Is the "commercial uses of Binance data" clause in force for us?
2. Are these terms enforceable against a party that never opened an account (browsewrap)? OKX 9.4 asserts so.
3. Does a transformed derived metric (e.g. cross-venue funding z-score) fall outside "Market Data" / "Service Data" / "derivative works", and under Indian copyright/database law?
4. Does OKX's India restriction bar Jakuraa from all OKX access, including public data?
5. Is moving the worker to a non-US region permissible, or characterisable as circumvention?
6. Does a US-hosted worker make us "operating in" the United States for Binance?
7. Do derived-model scores raise SEBI Research Analyst / Investment Adviser questions despite the disclaimer?
8. Should we pursue licences (OKX has a stated route; what to ask Binance/Bybit; Hyperliquid on-chain/own node)?
9. What indemnity / limitation language should Satelink's customer terms carry?
10. Until answered: pause Trading Intelligence, or limit it to Hyperliquid-only inputs?
