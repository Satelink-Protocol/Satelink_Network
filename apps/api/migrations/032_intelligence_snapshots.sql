-- 032_intelligence_snapshots.sql
-- M3 — Derived trading intelligence snapshot cache.
--
-- Mirrors ensureIntelTables() in src/intelligence/engine.js, which also runs at
-- boot (CREATE IF NOT EXISTS) — applying this migration is optional but keeps
-- migration history complete (same convention as 028_pricing_intelligence.sql).
--
-- The serving routes read the LATEST row per metric and report its `captured_at`
-- as `as_of`, with a `stale` flag when older than the freshness window. Derived
-- payloads only (no raw redistributed feeds); see src/intelligence/compute.js.
--
-- NOTE (migration numbering): the M7 branch (feat/m7-distribution) adds
-- 030/031; this file is 032 to avoid collision. Reconcile numbering at merge.

CREATE TABLE IF NOT EXISTS intelligence_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  metric      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  source_rows INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intel_snapshots_metric_time
  ON intelligence_snapshots (metric, captured_at DESC);
