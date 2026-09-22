-- 037_dodo_checkout_claims.sql
-- M5 follow-up (T-1.4 security fix): the Dodo checkout success redirect used
-- to embed the buyer's raw api_key in the return_url query string
-- (?account=<api_key>) — visible in browser history, server access logs,
-- and any Referer header the success page's outbound requests sent. This
-- table backs a one-time, short-lived, opaque claim token instead: the
-- checkout route stores {token -> api_key} here and puts ONLY the token in
-- the URL; the success page exchanges it exactly once, server-side, for the
-- key. The key itself now never appears in a URL, a log line, or a Referer.
--
-- Additive only — no drops, no renames. The live boot-time runner
-- (apps/api/src/db/dodo_rail_schema.js) applies the same idempotent DDL;
-- this numbered file is the reviewable record, matching the convention
-- established by 031/033/035/036.
CREATE TABLE IF NOT EXISTS dodo_checkout_claims (
  token       TEXT PRIMARY KEY,
  api_key     TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  claimed_at  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_dodo_checkout_claims_expires ON dodo_checkout_claims(expires_at);
