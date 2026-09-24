# Dodo Payments — business & product information (merchant verification)

_Prepared 2026-09-24 from statutory records and the live sites. Every value below is
verifiable; fields marked **FOUNDER** need input only the founder can give. Do not
submit invented volumes, customers or projections._

## 1. Legal entity
| Field | Value |
|---|---|
| Legal name | **Jakuraa Commercial Private Limited** |
| Former name | Falcor Commercial Private Limited (name changed; CIN unchanged) |
| Entity type | Private company limited by shares (Companies Act, 2013) |
| CIN | U52190TZ2019PTC033093 |
| Date of incorporation | 4 December 2019 |
| Registered office | 38, 39, First Floor, Malaviya Street, Ramnagar, Coimbatore, Tamil Nadu 641009, India |
| GSTIN | 33AADCF9341B1Z1 (Regular, Tamil Nadu) |
| IEC | AADCF9341B (DGFT Coimbatore) |
| Udyam | UDYAM-TN-03-0082507 (Micro) |
| PAN | **FOUNDER** — enter from the PAN card; must show the current legal name |
| Authorised signatory | **FOUNDER** — a director per the board resolution |
| Business phone | **FOUNDER** |

> **Name-match warning.** Dodo compares the legal name across documents. If PAN, GST,
> IEC or the bank account still show *Falcor Commercial Private Limited*, attach the
> fresh Certificate of Incorporation pursuant to change of name, or update those
> records first. See `docs/corporate/MOA_NOTE.md`.

## 2. Websites
| Purpose | URL |
|---|---|
| Company website | https://jakuraa.com |
| Statutory disclosure (Rule 26) | https://jakuraa.com/legal/company-information |
| Product website (where customers buy) | https://satelink.network |
| Pricing | https://satelink.network/pricing |
| Checkout | https://satelink.network/checkout?plan=starter |
| Customer console | https://console.satelink.network |
| Terms | https://satelink.network/terms |
| Privacy | https://satelink.network/privacy |
| Refund policy | https://satelink.network/refund |
| Acceptable use | https://satelink.network/acceptable-use |
| Contact | https://satelink.network/contact |

All URLs above returned HTTP 200 on 2026-09-24.

## 3. What is sold through Dodo
**Business description (for the form):** Satelink, a technology business of Jakuraa
Commercial Private Limited, sells prepaid API credits for *Trading Intelligence*:
derived market analytics (funding-rate heatmaps, open-interest shifts, market
microstructure, a liquidation-pressure model) computed from public market data and
delivered over an HTTPS API to developers and software agents. It is software/data
access, not investment advice, and Satelink never takes custody of customer funds.

| Product | Type | Price | Status |
|---|---|---|---|
| Starter Pack | One-time credit pack | USD 9.99 | Live at checkout |
| $50 pack (+5% bonus) | One-time credit pack | USD 50 | Not live — "notify me" |
| $200 pack (+10% bonus) | One-time credit pack | USD 200 | Not live — "notify me" |
| Pro | Subscription | USD 19 / month (USD 190 / year) | Catalogued in `/v1/plans`; not live at checkout |
| Max | Subscription | USD 79 / month (USD 790 / year) | Catalogued in `/v1/plans`; not live at checkout |

Usage prices inside the credits: USD 0.01 per Trading Intelligence call.

**Not sold through Dodo:** the crypto rail — x402 (USDC on Base) and USDT deposits on
Polygon — funds RPC and machine endpoints and is settled on-chain, outside Dodo. Card/UPI
money bought through Dodo only funds Trading Intelligence; the balances never mix.

- Delivery: instant, digital (credits applied to the customer's API key).
- Physical goods: none. Regulated goods: none.
- Customers: developers and businesses; individuals may also buy the Starter Pack.

## 4. Volumes and history
| Field | Value |
|---|---|
| Expected monthly volume | **FOUNDER** — give an honest estimate; there is no paid history to extrapolate from |
| Past processing history | None through Dodo. Earlier on-chain "revenue" was founder test data. |
| Chargebacks | None |

## 5. Support
- Support email: satelinknetwork@gmail.com (the address published on satelink.network).
  Consider a domain address (e.g. support@satelink.network) before submission.
- Company contact: hello@jakuraa.com — **FOUNDER:** confirm this inbox receives mail.
- Grievance officer (India): designation published at https://jakuraa.com/legal/grievance —
  **FOUNDER:** name the officer.

## 6. Before submitting
- [ ] PAN / GST / IEC / bank show the new name, or the name-change certificate is attached.
- [ ] Consider altering the MOA to add software/SaaS as a main object (`docs/corporate/MOA_NOTE.md`).
- [ ] Business phone and grievance officer added to jakuraa.com (`apps/corporate/content/company.ts`).
- [ ] Test-mode lifecycle passes (purchase → webhook → credits → refund) before switching to live.
