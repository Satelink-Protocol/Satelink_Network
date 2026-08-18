-- 012_nonce_schedule.sql
-- M9: Multi-nonce recurring schedule support.
--
-- ADDITIVE ONLY. One column added to authorizations, one new table.
-- No existing table/constraint/view is modified or removed.

-- Group authorizations belonging to the same nonce schedule.
-- NULL = not part of any schedule (legacy single-nonce authorizations).
ALTER TABLE authorizations ADD COLUMN schedule_id TEXT;

CREATE INDEX idx_authorizations_schedule
    ON authorizations (schedule_id)
 WHERE schedule_id IS NOT NULL;

-- Tracks the refill monitor's view of which authorization is "current"
-- purely for event-diffing between cycles (edge detection).
-- NEVER read for current-state reporting; /internal/recurring computes
-- the current auth dynamically using the enforceNew selection query.
CREATE TABLE schedule_state (
    schedule_id     TEXT PRIMARY KEY,
    principal_id    TEXT NOT NULL REFERENCES principals(id),
    current_auth_id TEXT NOT NULL REFERENCES authorizations(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
