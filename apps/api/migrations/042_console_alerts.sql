-- 042_console_alerts.sql (D7) — console alerts: per-account preferences and
-- alert history / de-dup. Additive only (two new tables, one index).
-- Applied on first use by ensureConsoleAccountsSchema (src/console_accounts/
-- schema.mjs), like 039; this numbered file is the reviewable record.
-- D7 alerts (migration 042). Usage % levels and the usage/email toggles stay in
-- account_settings (alert_thresholds, notifications) — one source of truth.
CREATE TABLE IF NOT EXISTS account_alert_prefs (
  account_id        TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  low_balance_usdt  NUMERIC(20,6) CHECK (low_balance_usdt IS NULL OR low_balance_usdt >= 0),
  deposit_confirmed BOOLEAN     NOT NULL DEFAULT TRUE,
  error_rate_pct    NUMERIC(5,2) CHECK (error_rate_pct IS NULL OR (error_rate_pct > 0 AND error_rate_pct <= 100)),
  cooldown_minutes  INTEGER     NOT NULL DEFAULT 360 CHECK (cooldown_minutes BETWEEN 15 AND 10080),
  enabled_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert history + de-dup: one row per (account, dedupe_key) ever, so a level,
-- deposit or cooldown window is notified once even across instances. Bounded:
-- the evaluator purges rows older than 180 days.
CREATE TABLE IF NOT EXISTS account_alert_events (
  id             BIGSERIAL PRIMARY KEY,
  account_id     TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind           TEXT        NOT NULL CHECK (kind IN ('usage', 'spend_cap', 'low_balance', 'deposit_confirmed', 'error_rate', 'test')),
  dedupe_key     TEXT        NOT NULL,
  subject        TEXT        NOT NULL,
  detail         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  delivery       TEXT        NOT NULL CHECK (delivery IN ('queued', 'sent', 'failed', 'suppressed', 'skipped_no_sender')),
  delivery_error TEXT,
  attempts       SMALLINT    NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at   TIMESTAMPTZ,
  UNIQUE (account_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS account_alert_events_account ON account_alert_events (account_id, created_at DESC);
