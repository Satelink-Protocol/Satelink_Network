-- 026_mandates.down.sql — reverts database/migrations/026_mandates.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DROP TRIGGER IF EXISTS mandates_guard ON mandates;
DROP FUNCTION IF EXISTS mandates_guard();
DROP INDEX IF EXISTS uq_mandates_lineage_version;
DROP INDEX IF EXISTS uq_mandates_one_active_per_lineage;
DROP INDEX IF EXISTS idx_mandates_principal_status;
DROP INDEX IF EXISTS idx_mandates_expiry;
ALTER TABLE mandates
    DROP CONSTRAINT IF EXISTS mandates_mode_code_matches,
    DROP CONSTRAINT IF EXISTS mandates_signed_doc_complete,
    DROP CONSTRAINT IF EXISTS mandates_active_is_signed,
    DROP CONSTRAINT IF EXISTS mandates_revoked_has_reason,
    DROP COLUMN IF EXISTS mode_code, DROP COLUMN IF EXISTS lineage_id, DROP COLUMN IF EXISTS version,
    DROP COLUMN IF EXISTS supersedes_id, DROP COLUMN IF EXISTS environment, DROP COLUMN IF EXISTS terms,
    DROP COLUMN IF EXISTS terms_hash, DROP COLUMN IF EXISTS sign_nonce, DROP COLUMN IF EXISTS sign_nonce_expires_at,
    DROP COLUMN IF EXISTS sign_attempts, DROP COLUMN IF EXISTS signature, DROP COLUMN IF EXISTS signature_key_id,
    DROP COLUMN IF EXISTS signed_at, DROP COLUMN IF EXISTS revocation_reason;
DELETE FROM schema_migrations WHERE filename = '026_mandates.sql';
COMMIT;
