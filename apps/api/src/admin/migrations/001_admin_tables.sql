-- Admin Command Center tables
-- Run against the Satelink-api Postgres DB (production DATABASE_URL).
-- This file is NOT auto-run on boot. Apply manually:
--   psql "$DATABASE_URL" -f apps/api/src/admin/migrations/001_admin_tables.sql

CREATE TABLE IF NOT EXISTS developer_intel (
  id                SERIAL PRIMARY KEY,
  ip                VARCHAR(50)  UNIQUE NOT NULL,
  asn               VARCHAR(100),
  isp               VARCHAR(200),
  country           VARCHAR(10),
  city              VARCHAR(100),
  user_agent        TEXT,
  classification    VARCHAR(50)  DEFAULT 'unknown',
  score             INTEGER      DEFAULT 0,
  days_active       INTEGER      DEFAULT 0,
  calls_today       INTEGER      DEFAULT 0,
  avg_daily_calls   INTEGER      DEFAULT 0,
  status            VARCHAR(50)  DEFAULT 'identified',
  notes             TEXT,
  outreach_attempts INTEGER      DEFAULT 0,
  last_outreach_at  TIMESTAMPTZ,
  first_seen        TIMESTAMPTZ  DEFAULT NOW(),
  last_seen         TIMESTAMPTZ  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id          SERIAL PRIMARY KEY,
  channel     VARCHAR(50),
  template_id VARCHAR(100) UNIQUE,
  target      VARCHAR(200),
  message     TEXT,
  status      VARCHAR(50)  DEFAULT 'draft',
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id          SERIAL PRIMARY KEY,
  job_name    VARCHAR(100),
  action      VARCHAR(500),
  result      JSONB,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_intel_class_score ON developer_intel (classification, score DESC);
CREATE INDEX IF NOT EXISTS idx_dev_intel_status ON developer_intel (status);
CREATE INDEX IF NOT EXISTS idx_auto_logs_job ON automation_logs (job_name, created_at DESC);
