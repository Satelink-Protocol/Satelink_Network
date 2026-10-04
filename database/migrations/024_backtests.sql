-- 024_backtests.sql
-- Stage 14 (trading agent): backtest and paper-run records. ADDITIVE ONLY.
--
-- One NEW table. FKs only to principals(id) and strategy_versions(id) (migration 021).
-- It is also the backtest job queue: status 'queued' rows are claimed with
-- FOR UPDATE SKIP LOCKED (no Redis/BullMQ). Results are labelled: a backtest is
-- 'hypothetical', a paper run 'simulated'; the CHECK makes any other pairing impossible.
-- Simulated results never touch orders / fills / positions / the ledger.
-- Down: database/migrations-down/024_backtests.down.sql (local/ephemeral only).

CREATE TABLE backtests (
    id                    TEXT        PRIMARY KEY,                         -- 'bkt_…' backtest | 'ppr_…' paper run
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    strategy_version_id   TEXT        NOT NULL REFERENCES strategy_versions(id),
    definition_hash       TEXT        NOT NULL CHECK (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
    mode                  TEXT        NOT NULL CHECK (mode IN ('backtest', 'paper')),
    label                 TEXT        NOT NULL,
    status                TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    engine_version        TEXT        NOT NULL,
    params                JSONB       NOT NULL,
    params_hash           TEXT        NOT NULL CHECK (params_hash ~ '^sha256:[0-9a-f]{64}$'),
    data_from             TIMESTAMPTZ,
    data_to               TIMESTAMPTZ,
    data_hash             TEXT        CHECK (data_hash IS NULL OR data_hash ~ '^sha256:[0-9a-f]{64}$'),
    bars                  INTEGER     CHECK (bars >= 0),
    result                JSONB,
    result_hash           TEXT        CHECK (result_hash IS NULL OR result_hash ~ '^sha256:[0-9a-f]{64}$'),
    passed                BOOLEAN,
    error                 TEXT,
    attempts              INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at            TIMESTAMPTZ,
    finished_at           TIMESTAMPTZ,
    CHECK ((mode = 'backtest' AND label = 'hypothetical' AND id ~ '^bkt_[A-Za-z0-9]{8,64}$')
        OR (mode = 'paper'    AND label = 'simulated'    AND id ~ '^ppr_[A-Za-z0-9]{8,64}$')),
    CHECK (mode = 'backtest' OR status <> 'queued'),                       -- only backtests are queued jobs
    CHECK (mode = 'paper' OR (data_from IS NOT NULL AND data_to IS NOT NULL AND data_to > data_from)),
    CHECK (status <> 'completed' OR (result IS NOT NULL AND result_hash IS NOT NULL AND passed IS NOT NULL AND bars IS NOT NULL)),
    CHECK (status NOT IN ('completed', 'failed', 'cancelled') OR finished_at IS NOT NULL),
    CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX idx_backtests_queue ON backtests (created_at, id) WHERE status = 'queued';
CREATE INDEX idx_backtests_principal ON backtests (principal_id, created_at DESC);
CREATE INDEX idx_backtests_version ON backtests (strategy_version_id, created_at DESC);

-- Provenance is immutable, and a finished run is frozen entirely.
CREATE FUNCTION backtests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'backtests row % is final (%) and cannot change', OLD.id, OLD.status;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
       OR NEW.strategy_version_id IS DISTINCT FROM OLD.strategy_version_id OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
       OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.label IS DISTINCT FROM OLD.label OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
       OR NEW.params IS DISTINCT FROM OLD.params OR NEW.params_hash IS DISTINCT FROM OLD.params_hash
       OR NEW.data_from IS DISTINCT FROM OLD.data_from OR NEW.data_to IS DISTINCT FROM OLD.data_to
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'backtests row %: provenance columns are immutable', OLD.id;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER backtests_guard BEFORE UPDATE ON backtests FOR EACH ROW EXECUTE FUNCTION backtests_guard();

REVOKE DELETE ON backtests FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE DELETE ON backtests FROM satelink_app';
    END IF;
END
$$;
