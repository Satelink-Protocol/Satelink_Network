-- 016_guardrails — tables backing the reconciler guardrails (2026-08-27).
--
-- Depends on nothing money-path; additive only.
--
-- driver_heartbeats: the control whose absence let the M9 endurance driver die at
-- call 64/5000 and go unnoticed for 6 days. Any long-running process that writes
-- to the money path MUST upsert a heartbeat here on a fixed interval. The
-- reconciler alarms when a row with status='active' stops advancing for >15 min.
-- A detached process on a laptop cannot be watched by file; a DB heartbeat can.
CREATE TABLE IF NOT EXISTS driver_heartbeats (
  driver_name       text PRIMARY KEY,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'complete', 'failed')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  calls_done        bigint,
  calls_planned     bigint,
  evidence_ref      text,               -- e.g. logs/m9_exit_gate_evidence.jsonl
  note              text
);

-- guardrail_alert_state: fire-once-per-window de-dup. One row per alert key holds
-- the last time an email was sent, so the reconciler sends at most one email per
-- condition (per subject) per window even though it evaluates every ~30s cycle.
CREATE TABLE IF NOT EXISTS guardrail_alert_state (
  alert_key    text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL
);
