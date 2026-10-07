/**
 * Stage 28 — migration 031_trading_credential_roles: only trading_credential_decryptor can read
 * broker_credential_ciphertexts (and therefore decrypt); satelink_app can INSERT a sealed
 * credential but cannot read it back; PUBLIC cannot read it. Down migration restores 017's grants.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB pointing at a LOCAL
 * server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import {
  LocalDevKeyProvider, sealSecret, openSecret, CREDENTIAL_DECRYPT_ROLE,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/security/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '031_trading_credential_roles.down.sql'), 'utf8');
const CTX = { credentialId: 'bkc_1', brokerAccountId: 'bka_1', principalId: 'prn_alice' };

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

/** Run fn on one connection as `role` (SET ROLE), always resetting. */
async function asRole<T>(pool: pg.Pool, role: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(`SET ROLE ${role}`);
    return await fn(c);
  } finally {
    await c.query('RESET ROLE').catch(() => {});
    c.release();
  }
}

describe('031_trading_credential_roles', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  const provider = new LocalDevKeyProvider({ masterKey: randomBytes(32) });
  const publicRole = `ta_public_${Date.now()}`;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_security_${Date.now()}`;
      const a = new pg.Client({ connectionString: local });
      await a.connect();
      await a.query(`CREATE DATABASE ${dbName}`);
      await a.end();
      const u = new URL(local);
      u.pathname = `/${dbName}`;
      conn = u.toString();
    } else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      conn = container.getConnectionUri();
    }
    const result = await applyMigrationsForTest(conn, MIGRATIONS_DIR);
    expect(result.errors).toHaveLength(0);
    expect(result.applied).toContain('031_trading_credential_roles.sql');
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`CREATE ROLE ${publicRole} NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${publicRole}`);
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    await pool.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment, status) VALUES ('bka_1', 'prn_alice', 'binance', 'paper', 'active')`);
  }, 120_000);

  afterAll(async () => {
    await pool?.query(`DROP OWNED BY ${publicRole}`).catch(() => {});
    await pool?.query(`DROP ROLE IF EXISTS ${publicRole}`).catch(() => {});
    await pool?.end();
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    }
  });

  it('the role exists, is NOLOGIN and not a superuser', async () => {
    const r = await pool.query(`SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [CREDENTIAL_DECRYPT_ROLE]);
    expect(r.rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);
  });

  it('satelink_app can INSERT a sealed credential but cannot read it back', async () => {
    await pool.query(`INSERT INTO broker_credentials_metadata (id, broker_account_id, kind, key_fingerprint, key_hint, kms_key_ref) VALUES ('bkc_1', 'bka_1', 'api_key', 'fp', 'ab12', $1)`, [provider.keyRef]);
    const row = await sealSecret({ provider, plaintext: 'binance-secret-for-test', context: CTX });
    await asRole(pool, 'satelink_app', (c) => c.query(
      `INSERT INTO broker_credential_ciphertexts (credential_id, encryption_alg, wrapped_dek, iv, auth_tag, ciphertext) VALUES ('bkc_1', $1, $2, $3, $4, $5)`,
      [row.encryption_alg, row.wrapped_dek, row.iv, row.auth_tag, row.ciphertext],
    ));
    await expect(asRole(pool, 'satelink_app', (c) => c.query('SELECT ciphertext FROM broker_credential_ciphertexts'))).rejects.toThrow(/permission denied/);
    await expect(asRole(pool, 'satelink_app', (c) => c.query(`UPDATE broker_credential_ciphertexts SET iv = iv`))).rejects.toThrow(/permission denied/);
  });

  it('a role with only default PUBLIC rights cannot read ciphertexts', async () => {
    await expect(asRole(pool, publicRole, (c) => c.query('SELECT 1 FROM broker_credential_ciphertexts'))).rejects.toThrow(/permission denied/);
  });

  it('ONLY trading_credential_decryptor can read — and decrypt — the credential', async () => {
    const r = await asRole(pool, CREDENTIAL_DECRYPT_ROLE, (c) => c.query(
      `SELECT c.encryption_alg, c.wrapped_dek, c.iv, c.auth_tag, c.ciphertext, m.kms_key_ref
         FROM broker_credential_ciphertexts c JOIN broker_credentials_metadata m ON m.id = c.credential_id WHERE c.credential_id = 'bkc_1'`,
    ));
    expect(r.rowCount).toBe(1);
    expect(await openSecret({ provider, row: r.rows[0], context: CTX })).toBe('binance-secret-for-test');
    const holders = await pool.query(
      `SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'broker_credential_ciphertexts' AND privilege_type = 'SELECT' AND grantee NOT IN (SELECT rolname FROM pg_roles WHERE rolsuper) ORDER BY grantee`,
    );
    expect(holders.rows.map((x) => x.grantee)).toEqual([CREDENTIAL_DECRYPT_ROLE]);
  });

  it('down migration restores 017\'s satelink_app grants and removes the decryptor grant', async () => {
    await pool.query(DOWN_SQL);
    const r = await asRole(pool, 'satelink_app', (c) => c.query('SELECT count(*)::int AS n FROM broker_credential_ciphertexts'));
    expect(r.rows[0].n).toBe(1);
    await expect(asRole(pool, CREDENTIAL_DECRYPT_ROLE, (c) => c.query('SELECT 1 FROM broker_credential_ciphertexts'))).rejects.toThrow(/permission denied/);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '031_trading_credential_roles.sql'`)).rowCount).toBe(0);
  });
});
