import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../runner.js';
import { computeDrawParity } from '../../apps/api/src/ledger/draw_parity.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '..',
  'migrations',
);

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();
  const result = await migrate(connectionString, MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString });
  
  await pool.query(`
    CREATE TABLE payment_sources (
      source text,
      amount_usd numeric(18,2),
      token text,
      network text,
      tx_hash text,
      payer text,
      credited_api_key text,
      is_test_data boolean,
      created_at timestamp DEFAULT now()
    )
  `);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

beforeEach(async () => {
  await pool.query('TRUNCATE payment_sources, draws RESTART IDENTITY CASCADE');
});

describe('computeDrawParity', () => {
  it('handles empty database', async () => {
    const data = await computeDrawParity(pool);
    expect(data.payment_sources_count).toBe(0);
    expect(data.draws_count).toBe(0);
    expect(data.parity_pct).toBe(100);
    expect(data.drift).toBe(0);
  });

  it('computes parity with matched x402 payments', async () => {
    await pool.query(`
      INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
      VALUES 
        ('x402', 1.50, 'USDC', 'base', '0x123', '0xabc', 'key1', false),
        ('x402', 2.00, 'USDC', 'base', '0x456', '0xdef', 'key2', false);
    `);
    // Only one has a draw, insert foreign key deps first
    await pool.query(`
      INSERT INTO principals (id, kind, state, version, created_at) VALUES ('0xabc', 'human', 'active', 1, now());
      INSERT INTO accounts (id, principal_id, kind, currency, decimals, normality, balance_invariant, state, version, created_at) VALUES ('0xabc', '0xabc', 'capacity', 'USDT', 6, 'credit', 'non_negative', 'open', 1, now());
      INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version, created_at) VALUES ('fs_x402_0xabc', '0xabc', 'base', '{"refType":"x402","refValue":"123"}'::jsonb, 'push', '{"settlement_latency":"instant"}'::jsonb, 'active', 1, now());
      INSERT INTO authorizations (id, principal_id, funding_source_id, cap_amount, currency, consumed_amount, valid_after, valid_before, signature_envelope, state, version, created_at) 
      VALUES ('auth_x402_0x123', '0xabc', 'fs_x402_0xabc', 2000000, 'USDC', 1500000, 0, 9999999999000, '{"scheme":"test","signature":"sig","signer":"signer"}'::jsonb, 'active', 1, now());

      INSERT INTO draws (
        id, principal_id, account_id, funding_source_id, authorization_id, 
        amount, currency, idempotency_key, created_at, state
      )
      VALUES (
        'draw_x402_0x123', '0xabc', '0xabc', 'fs_x402_0xabc', 'auth_x402_0x123',
        1500000, 'USDC', 'idem_x402_draw_0x123', 1234567890, 'settled'
      )
    `);

    const data = await computeDrawParity(pool);
    expect(data.payment_sources_count).toBe(2);
    expect(data.draws_count).toBe(1);
    expect(data.parity_pct).toBe(50); // 1 / 2 = 50%
    expect(data.drift).toBe(1);
    expect(data.sum_payment_usd).toBe('3.50');
    expect(data.sum_draws_usd).toBe('1.500000'); // 1500000 minor units
    expect(data.oldest_unmatched?.tx_hash).toBe('0x456');
  });

  it('ignores non-x402 and is_test_data', async () => {
    await pool.query(`
      INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer, credited_api_key, is_test_data)
      VALUES 
        ('x402', 1.50, 'USDC', 'base', '0x111', '0xabc', 'key1', true),
        ('stripe', 2.00, 'USDC', 'base', '0x222', '0xdef', 'key2', false)
    `);

    const data = await computeDrawParity(pool);
    expect(data.payment_sources_count).toBe(0);
    expect(data.draws_count).toBe(0);
    expect(data.parity_pct).toBe(100);
  });
});
