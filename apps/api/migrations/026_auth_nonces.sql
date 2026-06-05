-- 026_auth_nonces.sql
-- Wallet-based auth nonce table. Missing from production causes
-- "relation auth_nonces does not exist" on every wallet auth attempt.

CREATE TABLE IF NOT EXISTS auth_nonces (
  address    TEXT   NOT NULL,
  nonce      TEXT   NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  used_at    BIGINT,
  PRIMARY KEY (address, nonce)
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_address ON auth_nonces(address);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires ON auth_nonces(expires_at);
