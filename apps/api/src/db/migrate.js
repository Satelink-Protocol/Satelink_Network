// apps/api/src/db/migrate.js
// Auto-runs on server startup — idempotent (safe to run multiple times)
console.log('[migrate.js] MODULE LOADED at', new Date().toISOString());

export async function runMigrations(pool) {
  console.log('\n\n========== MIGRATE START ==========');
  console.log('[Migrate] RUNNING MIGRATIONS NOW at', new Date().toISOString());
  try {
    console.log('[Migrate] About to execute SQL...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS credit_balances (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        balance_usdt NUMERIC(18,6) NOT NULL DEFAULT 0,
        total_deposited NUMERIC(18,6) NOT NULL DEFAULT 0,
        total_spent NUMERIC(18,6) NOT NULL DEFAULT 0,
        last_deposit_tx VARCHAR(66),
        last_deposit_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT credit_balances_wallet_unique UNIQUE (wallet_address)
      );
      CREATE TABLE IF NOT EXISTS credit_deposits (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        amount_usdt NUMERIC(18,6) NOT NULL,
        tx_hash VARCHAR(66) NOT NULL,
        block_number BIGINT NOT NULL,
        chain_id INTEGER NOT NULL DEFAULT 137,
        confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT credit_deposits_tx_unique UNIQUE (tx_hash)
      );
      CREATE TABLE IF NOT EXISTS rpc_method_pricing (
        id SERIAL PRIMARY KEY,
        method_name VARCHAR(100) NOT NULL,
        price_usdt NUMERIC(12,8) NOT NULL DEFAULT 0.00003000,
        active BOOLEAN NOT NULL DEFAULT true,
        CONSTRAINT rpc_method_pricing_method_unique UNIQUE (method_name)
      );
      INSERT INTO rpc_method_pricing (method_name, price_usdt) VALUES
        ('eth_call',0.00003),('eth_blockNumber',0.00001),
        ('eth_getBlockByNumber',0.00003),('eth_getLogs',0.0001),
        ('eth_sendRawTransaction',0.00005),('eth_getBalance',0.00001),
        ('eth_getTransactionReceipt',0.00002),('eth_estimateGas',0.00003),
        ('net_listening',0.000005),('net_version',0.000005),
        ('eth_chainId',0.000005),('eth_getTransactionCount',0.00001)
      ON CONFLICT (method_name) DO NOTHING;

      -- Credit the missed $0.50 deposit (idempotent — ON CONFLICT skips if already done)
      INSERT INTO credit_deposits (wallet_address, amount_usdt, tx_hash, block_number, chain_id)
      VALUES (
        '0x966e1ae22996545015b1414b35234b10719d7ad4',
        0.500000,
        '0xdda807430571c695077bd810d0127da79c956969d91cc706d312c8ba2fa14b82',
        87441218, 137
      ) ON CONFLICT (tx_hash) DO NOTHING;

      INSERT INTO credit_balances (wallet_address, balance_usdt, total_deposited, last_deposit_tx, last_deposit_at)
      VALUES (
        '0x966e1ae22996545015b1414b35234b10719d7ad4',
        0.500000, 0.500000,
        '0xdda807430571c695077bd810d0127da79c956969d91cc706d312c8ba2fa14b82',
        NOW()
      ) ON CONFLICT (wallet_address) DO UPDATE SET
        balance_usdt = GREATEST(credit_balances.balance_usdt, 0.500000),
        total_deposited = GREATEST(credit_balances.total_deposited, 0.500000),
        last_deposit_tx = EXCLUDED.last_deposit_tx,
        last_deposit_at = NOW()
      WHERE credit_balances.total_deposited < 0.500000;
    `);

    // auth_nonces — wallet-based auth handshake (missing causes "relation does not exist")
    await pool.query(`
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
    `);
    const verify = await pool.query(`SELECT COUNT(*) as cnt FROM credit_balances`);
    console.log('[Migrate] Tables created. Rows in credit_balances:', verify.rows[0]?.cnt);
    console.log('========== MIGRATE DONE ==========\n\n');
  } catch (err) {
    console.error('========== MIGRATE FAILED ==========');
    console.error('[Migrate] Error:', err.message);
    console.error('========== END ERROR ==========');
    throw err;
  }
}
