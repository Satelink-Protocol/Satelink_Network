-- 025_risk_engine.sql
-- Stage 15 (trading agent): deterministic risk engine. ADDITIVE ONLY.
--
-- 1. NEW kill_switch_events: scoped, append-only engage/release log (latest event per
--    scope wins). principal_id NULL = platform-wide. FK only to principals(id).
-- 2. risk_policies (021) gains columns for the full policy (limits JSONB), its content
--    hash and author, a unique version per (principal, mandate), and becomes immutable:
--    a policy change is a new version row (trigger blocks UPDATE/DELETE).
-- Decision records go to audit_events (021, append-only), action 'risk.decision'.
-- Down: database/migrations-down/025_risk_engine.down.sql (local/ephemeral only).

CREATE TABLE kill_switch_events (
    id              BIGSERIAL   PRIMARY KEY,
    scope_type      TEXT        NOT NULL CHECK (scope_type IN ('global', 'principal', 'broker_account', 'mandate', 'strategy', 'venue', 'instrument')),
    scope_id        TEXT,
    principal_id    TEXT        REFERENCES principals(id),
    action          TEXT        NOT NULL CHECK (action IN ('engage', 'release')),
    source          TEXT        NOT NULL CHECK (source IN ('user', 'admin', 'circuit_breaker', 'system')),
    actor_id        TEXT        NOT NULL,
    reason          TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((scope_type = 'global') = (scope_id IS NULL)),
    CHECK (scope_type <> 'global' OR principal_id IS NULL),
    CHECK (scope_type <> 'principal' OR principal_id IS NULL OR scope_id = principal_id),
    CHECK (action = 'engage' OR source IN ('user', 'admin')),        -- breakers / system can only engage
    CHECK (source <> 'user' OR principal_id IS NOT NULL)              -- users act on their own scopes only
);
CREATE INDEX idx_kill_switch_scope ON kill_switch_events (scope_type, scope_id, principal_id, id DESC);
CREATE INDEX idx_kill_switch_principal ON kill_switch_events (principal_id, id);

REVOKE UPDATE, DELETE ON kill_switch_events FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON kill_switch_events FROM satelink_app';
    END IF;
END
$$;

ALTER TABLE risk_policies
    ADD COLUMN limits          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN policy_hash     TEXT  CHECK (policy_hash IS NULL OR policy_hash ~ '^sha256:[0-9a-f]{64}$'),
    ADD COLUMN created_by      TEXT,
    ADD COLUMN created_by_role TEXT  CHECK (created_by_role IN ('user', 'admin'));
CREATE UNIQUE INDEX uq_risk_policies_version ON risk_policies (principal_id, COALESCE(mandate_id, ''), version);

CREATE FUNCTION risk_policies_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'risk_policies rows are immutable versions (%): create a new version instead', TG_OP;
END
$$;
CREATE TRIGGER risk_policies_immutable BEFORE UPDATE OR DELETE ON risk_policies FOR EACH ROW EXECUTE FUNCTION risk_policies_immutable();
