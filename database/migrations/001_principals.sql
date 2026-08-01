-- 001_principals.sql
-- M2: Principal identity table.
--
-- Principals are the top-level identity in the financial domain.
-- Every account, authorization, and draw traces back to a principal.
--
-- Kind taxonomy: human (end user), agent (AI agent), machine (service account),
-- org (organization), project (billing container), platform (Satelink itself).

CREATE TABLE principals (
    id              TEXT        PRIMARY KEY,
    kind            TEXT        NOT NULL CHECK (kind IN ('human', 'agent', 'machine', 'org', 'project', 'platform')),
    parent_id       TEXT        REFERENCES principals(id),
    display_name    TEXT,
    external_ref    TEXT,
    state           TEXT        NOT NULL DEFAULT 'active',
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ
);

-- Hierarchy lookups: "all children of org X"
CREATE INDEX idx_principals_parent_id ON principals (parent_id);

-- Filtered queries: "all active agents"
CREATE INDEX idx_principals_kind_state ON principals (kind, state);

-- External system correlation — partial unique: only non-null values must be unique
CREATE UNIQUE INDEX idx_principals_external_ref ON principals (external_ref)
    WHERE external_ref IS NOT NULL;
