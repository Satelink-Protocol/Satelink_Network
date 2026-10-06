-- 026_mandates.sql
-- Stage 16 (trading agent): user-signed mandates. ADDITIVE ONLY (extends 021 mandates).
--
-- New nullable columns hold the signed document (terms JSONB + terms_hash), the one-time
-- signing nonce/challenge, the step-up attestation (signature + key id), lineage/version
-- for amendments, the A/B/C mode code and the revocation reason. Rows written by this
-- stage always have terms_hash; for them a trigger makes the signed terms immutable,
-- allows only legal status transitions and freezes final states. DELETE is blocked.
-- Down: database/migrations-down/026_mandates.down.sql (local/ephemeral only).

ALTER TABLE mandates
    ADD COLUMN mode_code             TEXT CHECK (mode_code IN ('A', 'B', 'C')),
    ADD COLUMN lineage_id            TEXT CHECK (lineage_id ~ '^mdl_[A-Za-z0-9]{8,64}$'),
    ADD COLUMN version               INTEGER CHECK (version >= 1),
    ADD COLUMN supersedes_id         TEXT REFERENCES mandates(id),
    ADD COLUMN environment           TEXT CHECK (environment IN ('paper', 'live')),
    ADD COLUMN terms                 JSONB,
    ADD COLUMN terms_hash            TEXT CHECK (terms_hash ~ '^sha256:[0-9a-f]{64}$'),
    ADD COLUMN sign_nonce            TEXT CHECK (sign_nonce ~ '^[0-9a-f]{32}$'),
    ADD COLUMN sign_nonce_expires_at TIMESTAMPTZ,
    ADD COLUMN sign_attempts         INTEGER NOT NULL DEFAULT 0 CHECK (sign_attempts >= 0),
    ADD COLUMN signature             TEXT CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
    ADD COLUMN signature_key_id      TEXT,
    ADD COLUMN signed_at             TIMESTAMPTZ,
    ADD COLUMN revocation_reason     TEXT CHECK (char_length(revocation_reason) BETWEEN 1 AND 500);

ALTER TABLE mandates
    ADD CONSTRAINT mandates_mode_code_matches CHECK (mode_code IS NULL OR (mode_code = 'A') = (mode = 'copilot')),
    ADD CONSTRAINT mandates_signed_doc_complete CHECK (terms_hash IS NULL OR (terms IS NOT NULL AND lineage_id IS NOT NULL AND version IS NOT NULL
                                                       AND mode_code IS NOT NULL AND environment IS NOT NULL AND sign_nonce IS NOT NULL AND valid_until IS NOT NULL)),
    ADD CONSTRAINT mandates_active_is_signed CHECK (terms_hash IS NULL OR status <> 'active' OR (signature IS NOT NULL AND signed_at IS NOT NULL AND signature_key_id IS NOT NULL)),
    ADD CONSTRAINT mandates_revoked_has_reason CHECK (terms_hash IS NULL OR status <> 'revoked' OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL));

CREATE UNIQUE INDEX uq_mandates_lineage_version ON mandates (lineage_id, version) WHERE lineage_id IS NOT NULL;
CREATE UNIQUE INDEX uq_mandates_one_active_per_lineage ON mandates (lineage_id) WHERE status = 'active' AND lineage_id IS NOT NULL;
CREATE INDEX idx_mandates_principal_status ON mandates (principal_id, status);
CREATE INDEX idx_mandates_expiry ON mandates (valid_until) WHERE status = 'active';

CREATE FUNCTION mandates_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'mandates rows cannot be deleted (revoke instead)';
    END IF;
    IF OLD.terms_hash IS NULL THEN
        RETURN NEW;                                   -- pre-Stage-16 rows: unchanged behaviour
    END IF;
    IF OLD.status IN ('revoked', 'expired') THEN
        RAISE EXCEPTION 'mandate % is final (%)', OLD.id, OLD.status;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.principal_id IS DISTINCT FROM OLD.principal_id OR NEW.broker_account_id IS DISTINCT FROM OLD.broker_account_id
       OR NEW.strategy_id IS DISTINCT FROM OLD.strategy_id OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.mode_code IS DISTINCT FROM OLD.mode_code
       OR NEW.max_notional_minor IS DISTINCT FROM OLD.max_notional_minor OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.decimals IS DISTINCT FROM OLD.decimals
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.lineage_id IS DISTINCT FROM OLD.lineage_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
       OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.terms IS DISTINCT FROM OLD.terms OR NEW.terms_hash IS DISTINCT FROM OLD.terms_hash
       OR NEW.sign_nonce IS DISTINCT FROM OLD.sign_nonce OR NEW.sign_nonce_expires_at IS DISTINCT FROM OLD.sign_nonce_expires_at THEN
        RAISE EXCEPTION 'mandate %: signed terms are immutable (propose a new version)', OLD.id;
    END IF;
    IF NOT ((OLD.status = 'draft' AND NEW.status IN ('draft', 'active', 'revoked'))
         OR (OLD.status = 'active' AND NEW.status IN ('revoked', 'expired'))) THEN
        RAISE EXCEPTION 'mandate %: illegal status transition % -> %', OLD.id, OLD.status, NEW.status;
    END IF;
    IF OLD.status <> 'draft' AND (NEW.signature IS DISTINCT FROM OLD.signature OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.step_up_method IS DISTINCT FROM OLD.step_up_method OR NEW.signature_key_id IS DISTINCT FROM OLD.signature_key_id
       OR NEW.sign_attempts IS DISTINCT FROM OLD.sign_attempts) THEN
        RAISE EXCEPTION 'mandate %: the signature is fixed once signed', OLD.id;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER mandates_guard BEFORE UPDATE OR DELETE ON mandates FOR EACH ROW EXECUTE FUNCTION mandates_guard();
