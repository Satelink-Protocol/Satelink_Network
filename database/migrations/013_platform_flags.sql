-- platform_flags: runtime kill-switch table.
-- Allows flipping CAPACITY_ENFORCEMENT_PATH without a redeploy.
-- All consumers must fail-closed to 'legacy' on read error.

CREATE TABLE IF NOT EXISTS platform_flags (
  key         text        PRIMARY KEY,
  value       text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

-- Seed the current live value. Safe to re-run (ON CONFLICT DO NOTHING).
INSERT INTO platform_flags (key, value, updated_by)
VALUES ('capacity_enforcement_path', 'legacy', 'migration-seed')
ON CONFLICT (key) DO NOTHING;
