-- scripts/dodo-tasks/analytics.sql
--
-- Minimal task-commerce analytics: one query, not a dashboard.
-- Run:
--   psql "$DATABASE_URL" -f scripts/dodo-tasks/analytics.sql
--
-- Per-status breakdown (GROUP BY ROLLUP adds a TOTAL row at the end) of:
--   - orders by status
--   - revenue collected (sum of price_inr — gross; pending_payment orders
--     were never charged and are excluded from this sum, but still counted
--     in order_count for completeness)
--   - average Apify cost per order (only set on orders that reached Apify,
--     i.e. fulfilled or failed-after-Apify-ran; NULL rows don't count
--     against the average)
--   - average fulfilment time in minutes (paid_at -> fulfilled_at; only
--     meaningful on the 'fulfilled' row)
--
-- Note: the TOTAL row's revenue_inr is GROSS across all non-pending
-- statuses, including 'refunded' orders (their price_inr is still counted
-- there since it was actually charged). To get NET revenue, subtract the
-- 'refunded' row's revenue_inr from the TOTAL row's revenue_inr.

SELECT
  COALESCE(status, 'TOTAL') AS status,
  COUNT(*) AS order_count,
  SUM(price_inr) FILTER (WHERE status <> 'pending_payment') AS revenue_inr,
  ROUND(AVG(apify_cost_usd)::numeric, 4) AS avg_apify_cost_usd,
  ROUND(AVG(EXTRACT(EPOCH FROM (fulfilled_at - paid_at)) / 60)::numeric, 1) AS avg_fulfillment_minutes
FROM task_orders
GROUP BY ROLLUP (status)
ORDER BY status NULLS LAST;
