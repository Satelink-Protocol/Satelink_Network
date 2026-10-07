-- 031_trading_credential_roles — Stage 28 (security hardening, option 1: no cloud KMS)
--
-- A separate database role for broker-credential DECRYPTION. Only trading_credential_decryptor
-- may read broker_credential_ciphertexts (the wrapped DEKs + ciphertexts from migration 021).
-- The application role satelink_app can store a new ciphertext (INSERT) but can never read one
-- back: reading happens only in the execution service, connected as a login role that is a member
-- of trading_credential_decryptor. A compromised API process therefore cannot exfiltrate the
-- encrypted material, and even with it would still need the key provider to unwrap a DEK.
--
-- * Additive: one NOLOGIN role + grants. No table, column or data change.
-- * The superuser / table owner keeps access (same caveat as 004/017/021).
-- * Granting membership in the role is a founder/ops action, never a migration:
--     CREATE ROLE <exec_service_login> LOGIN PASSWORD '<secret>' IN ROLE trading_credential_decryptor;
-- * Down migration: database/migrations-down/031_trading_credential_roles.down.sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trading_credential_decryptor') THEN
        CREATE ROLE trading_credential_decryptor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO trading_credential_decryptor;
REVOKE ALL ON broker_credential_ciphertexts FROM PUBLIC;
GRANT SELECT ON broker_credential_ciphertexts TO trading_credential_decryptor;
-- To unwrap a DEK the decryptor needs the wrapping key ref and the credential's status (non-secret).
GRANT SELECT (id, broker_account_id, kms_key_ref, status, revoked_at) ON broker_credentials_metadata TO trading_credential_decryptor;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        -- 017's default privileges gave satelink_app SELECT/UPDATE/DELETE on every new table: take
        -- the read (and rewrite) away; keep INSERT so the API can store a freshly sealed credential.
        EXECUTE 'REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON broker_credential_ciphertexts FROM satelink_app';
        EXECUTE 'GRANT INSERT ON broker_credential_ciphertexts TO satelink_app';
    END IF;
END
$$;
