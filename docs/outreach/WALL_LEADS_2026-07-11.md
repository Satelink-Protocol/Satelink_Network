# Wall-Hitter Leads — Customer Zero War Room (2026-07-11)

Source: production `developer_intel`, queried 2026-07-10/11. These are the
organizations that hit the 500-call/day free cap and **returned daily for up
to 23 straight days** — the warmest conversion leads the network has.
External revenue to date: **$0.00** (all `payment_sources` rows are founder
test wallets, flagged `is_test_data` since PR #241).

> **Send policy:** cold-emailing inferred ISP/abuse addresses was explicitly
> rejected (see memory `outreach-email-collection`, PR #210). Everything here
> is a DRAFT for human review + manual send. The one sanctioned address is
> Rica Web Services (CLAUDE.md P0 #3). Wallet-less IP leads have no owner
> contact — for those, the "outreach" is the product itself: as of the
> free-taste restore, their next 402 lands mid-workload with a legible
> purchase path.

## Top 20 leads (by sustained demand above the free cap)

| # | IP | Org / ISP | Client | Avg calls/day | Days active | Note |
|---|----|-----------|--------|---------------|-------------|------|
| 1 | 95.217.88.113 | (Hetzner range, ISP unresolved) | Go-http-client/2.0 | 17,994 | 23 | Wants 36× the free cap |
| 2 | 65.108.122.248 | Hetzner (FI) | node | 15,415 | 23 | Caps at 500 daily |
| 3 | 2.11.128.100 | (unresolved) | Bun/1.3.10 | 14,984 | 23 | Modern JS stack |
| 4 | 87.58.199.98 | (unresolved) | axios/1.13.5 | 8,211 | 23 | classified developer |
| 5 | 51.79.18.71 | OVH range | axios/1.15.0 | 3,978 | 23 | Caps daily |
| 6 | 139.99.124.165 | OVH (SG) | (none) | 3,138 | 21 | Went quiet Jul 7 — the hard-402 date |
| 7 | 198.13.36.46 | (Vultr range) | Go-http-client/2.0 | 1,896 | 23 | score 28 (top classifier score) |
| 8 | 82.137.108.65 | (unresolved) | — | 1,734 | 23 | Caps daily |
| 9 | 31.77.57.255 | interlir (DE) | node | 1,732 | 22 | Single-IP org, steady |
| 10 | 157.90.89.179 | Hetzner range | axios/1.13.5 | 1,677 | 23 | score 28 |
| 11 | 148.251.10.246 | Hetzner (DE) | (none) | 1,338 | 21 | Went quiet Jul 7 |
| 12 | 65.108.125.227 | Hetzner (FI) | (none) | 1,069 | 20 | Went quiet Jul 6 |
| 13 | 62.72.27.186 | (unresolved) | axios/1.13.5 | 1,050 | 23 | score 28 |
| 14 | 51.81.167.217 | OVH range | (none) | 1,043 | 21 | Went quiet Jul 6 |
| 15 | 157.180.108.168 | (unresolved) | node.js/16.20.2 | 1,023 | 23 | Caps daily |
| 16 | 5.161.65.4 | Hetzner US range | (none) | 875 | 21 | Went quiet Jul 6 |
| 17 | 95.97.18.186 | (unresolved) | — | 847 | 23 | Caps daily |
| 18 | 38.49.212.250 | **Rica Web Services** | python-requests/2.32.5 | 803 | 23 | **Sanctioned contact: support@servarica.com (P0 #3)** |
| 19 | 51.91.58.1 | OVH range | — | 774 | 23 | Caps daily |
| 20 | 23.191.152.46 | (unresolved) | Go-http-client/2.0 | 592 | 23 | score 28 |

Observations that shape the pitch:
- Five leads (#6, #11, #12, #14, #16) went quiet on/after **July 7** — the day
  the unconditional 402 shipped. They are churn caused by the hard wall; the
  free-taste restore is the win-back mechanism.
- Zero leads use an x402-capable client. The purchase path that fits them is
  the **$0.10 = 1,000 calls bundle** (one payment, no subscription) or a small
  USDT deposit — both now spelled out in plain steps inside every 402.

## Draft 1 — Rica Web Services (sanctioned, human sends)

To: support@servarica.com
Subject: Your Polygon RPC traffic on Satelink — 800+ calls/day hitting our free cap

> Hi — I run Satelink (rpc.satelink.network), one of the Polygon RPC
> endpoints your infrastructure has been calling ~800×/day for the past
> three weeks (source IP 38.49.212.250).
>
> You're hitting our 500-call/day free cap, which means your client is
> getting rate-limited every day around the same time. Two ways to fix that
> on your side today:
>
> 1. **$0.10 = 1,000 extra calls** — one USDC micro-payment, no account:
>    https://rpc.satelink.network/v1/pricing
> 2. **Prepaid credits** — $0.50 minimum USDT deposit, pay-per-call at
>    $0.00003 (~$30/million), no subscription:
>    https://rpc.satelink.network/.well-known/satelink.json
>
> Or if the free tier is all you need, no action required — this is the only
> email we'll send. Happy to raise your cap for a trial period if you tell
> me a bit about the workload.
>
> — Satelink

## Draft 2 — generic wall-hitter (used if/when a lead registers a wallet or opts in)

Subject: You're rate-capped on Satelink — here's the 30-second fix

> Your machine at <IP> has hit Satelink's 500-call/day free cap on <N> of the
> last <M> days. The next 402 response it receives contains everything needed
> to lift the cap programmatically (`how_to_pay` field), but the short
> version: one $0.10 x402 payment = 1,000 calls, or a $0.50 USDT deposit for
> pay-per-call credits. No signup, no subscription. Pricing + market
> comparison: https://rpc.satelink.network/v1/compare

## Success metric

First **external** (non-founder) row in `payment_sources` / `api_deposits`.
Watch: `GET /internal/x402-funnel` (issued/attempts/settlements + external
USD) and `GET /admin/pricing/command-center` (funnel block).
