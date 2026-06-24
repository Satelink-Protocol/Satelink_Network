# ANALYTICS TOOLS

## PostHog (free tier — add later)
Purpose: Track funnel: free_tier_ip → 402_hit → deposit_page_visit → deposit_complete → paid_call
Setup when first paying customer appears.
Event names to track:
  - free_tier_limit_reached
  - deposit_page_visited
  - deposit_initiated
  - deposit_confirmed
  - first_paid_call
  - recurring_deposit

## Current analytics (no PostHog needed yet):
  - /stats/free-tier → active IPs and near-limit count
  - /system/revenue-anomalies → revenue rate per hour
  - /credits/balance?wallet= → individual wallet balance
  - Railway logs → DepositListener events
