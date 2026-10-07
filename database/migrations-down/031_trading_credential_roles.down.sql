-- Rollback for 031_trading_credential_roles (local / ephemeral databases only). Run before 021's down.
-- Restores 017's default grants on broker_credential_ciphertexts. The role itself is cluster-wide and
-- may hold grants in other databases, so it is left in place (harmless: NOLOGIN, no grants here).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trading_credential_decryptor') THEN
        EXECUTE 'REVOKE ALL ON broker_credential_ciphertexts FROM trading_credential_decryptor';
        EXECUTE 'REVOKE SELECT (id, broker_account_id, kms_key_ref, status, revoked_at) ON broker_credentials_metadata FROM trading_credential_decryptor';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON broker_credential_ciphertexts TO satelink_app';
    END IF;
END
$$;
DELETE FROM schema_migrations WHERE filename = '031_trading_credential_roles.sql';
