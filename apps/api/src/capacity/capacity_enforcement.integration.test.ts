/**
 * Capacity enforcement (new path) against a real Postgres. Proves the M8
 * decision core in SQL — the same module wired at the RPC gateway:
 *   - resolves a principal by external_ref;
 *   - classifies denials distinctly: no_authorization / authorization_expired /
 *     insufficient_capacity;
 *   - the atomic draw makes exactly N-1 of N calls succeed against a cap of
 *     (N-1)*cost, with the Nth denied insufficient_capacity;
 *   - never over-draws past the cap (DB CHECK consumed<=cap holds).
 *
 * Imports the SHIPPED JS module (apps/api/src/capacity/capacity_enforcement.js)
 * so the test exercises the real query, not a re-transcription.
 */

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../../../../database/runner.js';
// @ts-expect-error — importing the shipped JS enforcement module (no d.ts).
import { __internal, enforcementPath, enforceCapacity } from './capacity_enforcement.js';
// @ts-expect-error — shipped JS flag reader (no d.ts).
import { bustCapacityPathCache } from '../lib/flags.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../database/migrations',
);

const WALLET = '0x00000000000000000000000000000000000000a1';
const PRINCIPAL = 'prn_test_capacity_a1';
const FUNDING = 'fund_test_a1';
const AUTH = 'auth_test_a1';
const COST = 30;
const CAP = 150; // (6-1)*30 → 5 draws succeed, 6th denies

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await migrate(container.getConnectionUri(), MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString: container.getConnectionUri() });
  pool.on('error', () => {});
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

async function seed(opts: { validAfter?: number; validBefore?: number; consumed?: number } = {}) {
  const validAfter = opts.validAfter ?? 0;
  const validBefore = opts.validBefore ?? Date.now() + 30 * 24 * 3600 * 1000;
  const consumed = opts.consumed ?? 0;
  await pool.query(
    `INSERT INTO principals (id, kind, external_ref, state) VALUES ($1,'machine',$2,'active')`,
    [PRINCIPAL, WALLET],
  );
  await pool.query(
    `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
     VALUES ($1,$2,'x402-base-usdc','{"refType":"eip3009","refValue":"{}"}'::jsonb,'authorization',
             '{"supportsRecurring":false,"supportsEscrow":false,"supportsRefund":false,"agentCompatible":true,"settlementLatency":"seconds","custodial":false}'::jsonb,
             'verified',1)`,
    [FUNDING, PRINCIPAL],
  );
  await pool.query(
    `INSERT INTO authorizations
       (id, principal_id, funding_source_id, cap_amount, currency, consumed_amount, valid_after, valid_before, signature_envelope, state, version)
     VALUES ($1,$2,$3,$4,'USDC',$5,$6,$7,'{"scheme":"exact","signature":"0xsig","signer":"0x00"}'::jsonb,'active',1)`,
    [AUTH, PRINCIPAL, FUNDING, CAP, consumed, validAfter, validBefore],
  );
}

/** Seed a principal + funding source with N authorizations sharing one
 * valid_before, for tiebreak testing (issue #322). */
async function seedTied(
  auths: { id: string; cap: number; consumed?: number }[],
  validBefore = Date.now() + 30 * 24 * 3600 * 1000,
) {
  await pool.query(
    `INSERT INTO principals (id, kind, external_ref, state) VALUES ($1,'machine',$2,'active')`,
    [PRINCIPAL, WALLET],
  );
  await pool.query(
    `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
     VALUES ($1,$2,'x402-base-usdc','{"refType":"eip3009","refValue":"{}"}'::jsonb,'authorization',
             '{"supportsRecurring":false,"supportsEscrow":false,"supportsRefund":false,"agentCompatible":true,"settlementLatency":"seconds","custodial":false}'::jsonb,
             'verified',1)`,
    [FUNDING, PRINCIPAL],
  );
  for (const a of auths) {
    await pool.query(
      `INSERT INTO authorizations
         (id, principal_id, funding_source_id, cap_amount, currency, consumed_amount, valid_after, valid_before, signature_envelope, state, version)
       VALUES ($1,$2,$3,$4,'USDC',$5,0,$6,'{"scheme":"exact","signature":"0xsig","signer":"0x00"}'::jsonb,'active',1)`,
      [a.id, PRINCIPAL, FUNDING, a.cap, a.consumed ?? 0, validBefore],
    );
  }
}

beforeEach(async () => {
  await pool.query('TRUNCATE principals RESTART IDENTITY CASCADE');
});

describe('capacity enforcement — new path (integration)', () => {
  it('default enforcement path is legacy', () => {
    expect(enforcementPath()).toBe('legacy');
  });

  it('denies no_authorization when the identity has no principal/authorization', async () => {
    const v = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('no_authorization');
  });

  it('denies authorization_expired when all active authorizations are out of window', async () => {
    await seed({ validAfter: 0, validBefore: 1000 }); // long past
    const v = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('authorization_expired');
  });

  it('makes exactly N-1 of N draws succeed against a cap of (N-1)*cost, Nth denies insufficient_capacity', async () => {
    await seed(); // cap 150, cost 30 → 5 succeed
    const outcomes: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const v = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
      outcomes.push(v.ok);
    }
    expect(outcomes).toEqual([true, true, true, true, true, false]);

    const last = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
    expect(last.ok).toBe(false);
    expect(last.code).toBe('insufficient_capacity');

    const { rows } = await pool.query('SELECT cap_amount, consumed_amount FROM authorizations WHERE id=$1', [AUTH]);
    expect(rows[0].cap_amount).toBe('150');
    expect(rows[0].consumed_amount).toBe('150'); // exactly cap, never over
  });

  it('classifies capacity read-only without mutating (dual-mode eval)', async () => {
    await seed({ consumed: 120 }); // 30 remaining
    const before = await pool.query('SELECT consumed_amount FROM authorizations WHERE id=$1', [AUTH]);
    const pid = await __internal.resolvePrincipalId(pool, { wallet: WALLET });
    const allow = await __internal.classifyCapacity(pool, pid, 30, Date.now());
    expect(allow.decision).toBe('allow');
    const deny = await __internal.classifyCapacity(pool, pid, 31, Date.now());
    expect(deny.decision).toBe('deny');
    expect(deny.reason).toBe('insufficient_capacity');
    const after = await pool.query('SELECT consumed_amount FROM authorizations WHERE id=$1', [AUTH]);
    expect(after.rows[0].consumed_amount).toBe(before.rows[0].consumed_amount); // unchanged
  });

  // Issue #322: enforceNew selected among a principal's authorizations by
  // principal_id alone. Two authorizations sharing the same valid_before
  // (M9's multi-authorization designs can produce this) had no tiebreak,
  // so which one absorbed a draw was scan-order-dependent, not policy-
  // dependent. Fix: ORDER BY valid_before ASC, id ASC — the same
  // lexicographic-by-identifier tiebreak CapacitySelector already uses for
  // nonces (libs/financial-domain/src/authorization/capacity-selector.ts)
  // and the same key postgres-authorization-repository.ts already orders
  // findByPrincipal by.
  describe('authorization selection tiebreak (issue #322)', () => {
    it('breaks a valid_before tie deterministically on id ASC, repeatedly', async () => {
      // 'auth_test_aa' < 'auth_test_zz' lexicographically — aa must be
      // drawn from first, every time, across repeated calls.
      await seedTied([
        { id: 'auth_test_zz', cap: 1_000_000 },
        { id: 'auth_test_aa', cap: 60 }, // exactly 2 draws of cost 30
      ]);

      const v1 = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
      expect(v1.ok).toBe(true);
      expect(v1.authorizationId).toBe('auth_test_aa');

      const v2 = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
      expect(v2.ok).toBe(true);
      expect(v2.authorizationId).toBe('auth_test_aa');

      // auth_test_aa is now exhausted (60/60) — the next draw must fall
      // through to auth_test_zz, not deny, proving the tiebreak governs
      // ordering rather than excluding the other authorization entirely.
      const v3 = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
      expect(v3.ok).toBe(true);
      expect(v3.authorizationId).toBe('auth_test_zz');

      const rows = (
        await pool.query(
          'SELECT id, consumed_amount FROM authorizations WHERE id IN ($1,$2) ORDER BY id',
          ['auth_test_aa', 'auth_test_zz'],
        )
      ).rows;
      expect(rows).toEqual([
        { id: 'auth_test_aa', consumed_amount: '60' },
        { id: 'auth_test_zz', consumed_amount: '30' },
      ]);
    });

    it('is deterministic regardless of insertion order', async () => {
      // Same two ids, inserted in the opposite order — selection must still
      // land on auth_test_aa first. Guards against relying on physical/
      // insertion scan order instead of the explicit ORDER BY.
      await seedTied([
        { id: 'auth_test_aa', cap: 30 },
        { id: 'auth_test_zz', cap: 30 },
      ]);
      const v = await __internal.enforceNew(pool, { wallet: WALLET, cost: COST });
      expect(v.ok).toBe(true);
      expect(v.authorizationId).toBe('auth_test_aa');
    });

    it('an explicit authorizationId filter overrides the natural tiebreak', async () => {
      // Both have headroom and share valid_before, so the natural order
      // would pick auth_test_aa — but an explicit authorizationId targets
      // auth_test_zz instead, for tests/diagnostics that need to reach a
      // specific authorization without hand-writing SQL.
      await seedTied([
        { id: 'auth_test_aa', cap: 1_000_000 },
        { id: 'auth_test_zz', cap: 1_000_000 },
      ]);
      const v = await __internal.enforceNew(pool, {
        wallet: WALLET,
        cost: COST,
        authorizationId: 'auth_test_zz',
      });
      expect(v.ok).toBe(true);
      expect(v.authorizationId).toBe('auth_test_zz');

      const rows = (
        await pool.query(
          'SELECT id, consumed_amount FROM authorizations WHERE id IN ($1,$2) ORDER BY id',
          ['auth_test_aa', 'auth_test_zz'],
        )
      ).rows;
      expect(rows).toEqual([
        { id: 'auth_test_aa', consumed_amount: '0' }, // untouched — filter excluded it
        { id: 'auth_test_zz', consumed_amount: '30' },
      ]);
    });

    it('a targeted authorizationId denies insufficient_capacity scoped to that row, even with headroom elsewhere', async () => {
      // auth_test_aa is exhausted; auth_test_zz has plenty of headroom.
      // Targeting auth_test_aa specifically must deny — the fallback
      // classification must not "see" auth_test_zz's headroom and
      // misreport allow.
      await seedTied([
        { id: 'auth_test_aa', cap: 30, consumed: 30 },
        { id: 'auth_test_zz', cap: 1_000_000 },
      ]);
      const v = await __internal.enforceNew(pool, {
        wallet: WALLET,
        cost: COST,
        authorizationId: 'auth_test_aa',
      });
      expect(v.ok).toBe(false);
      expect(v.code).toBe('insufficient_capacity');

      const rows = (
        await pool.query(
          'SELECT id, consumed_amount FROM authorizations WHERE id IN ($1,$2) ORDER BY id',
          ['auth_test_aa', 'auth_test_zz'],
        )
      ).rows;
      expect(rows).toEqual([
        { id: 'auth_test_aa', consumed_amount: '30' }, // unchanged, still exhausted
        { id: 'auth_test_zz', consumed_amount: '0' }, // untouched — filter excluded it
      ]);
    });
  });
});

// api_credits fallback for 'new' mode (enforceCapacity, not enforceNew directly).
// enforceNew has no api_credits path; enforceCapacity's 'new' branch adds one:
// only a 'no_authorization' denial falls through to legacy authorizeAndMeter, so
// api_credits accounts keep working under a global 'new' flip WITHOUT turning the
// fallback into a bypass. These cases pin the three decisions the gate cares about:
//   (a) over-cap authorization  -> still deny insufficient_capacity (no fallthrough)
//   (b) no auth AND no account   -> still deny (account_not_found), not a bypass
//   (c) no auth BUT has credits  -> fall through to api_credits (the only new behavior)
// authorizeAndMeter reads api_credits / api_usage_daily, which are NOT in the
// financial-domain migrations, so this block creates them as a fixture.
describe('capacity enforcement — new-mode api_credits fallback (integration)', () => {
  const UNFUNDED = '0x00000000000000000000000000000000000000b3'; // no auth, no account

  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_credits (
        api_key        text PRIMARY KEY,
        wallet_address text,
        tier           text        NOT NULL DEFAULT 'free',
        daily_limit    integer,
        credits_usdt   numeric     NOT NULL DEFAULT 0,
        total_spent    numeric     NOT NULL DEFAULT 0,
        status         text        NOT NULL DEFAULT 'active',
        last_used      timestamptz,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS api_usage_daily (
        api_key       text    NOT NULL,
        date          date    NOT NULL,
        request_count integer NOT NULL DEFAULT 0,
        usdt_spent    numeric NOT NULL DEFAULT 0,
        PRIMARY KEY (api_key, date)
      );
    `);
  });

  beforeEach(async () => {
    // top-level beforeEach already truncated principals (→ no authorizations).
    await pool.query('TRUNCATE api_credits');
    await pool.query('TRUNCATE api_usage_daily');
    await pool.query(`UPDATE platform_flags SET value='new' WHERE key='capacity_enforcement_path'`);
    bustCapacityPathCache(); // 10s TTL — force enforceCapacity to observe 'new'
  });

  afterAll(async () => {
    await pool.query(`UPDATE platform_flags SET value='legacy' WHERE key='capacity_enforcement_path'`);
    bustCapacityPathCache();
  });

  it('(c) no authorization but funded api_credits → falls through to api_credits (allow)', async () => {
    // No principal/authorization for WALLET (truncated); only an api_credits account.
    await pool.query(
      `INSERT INTO api_credits (api_key, wallet_address, tier, daily_limit, credits_usdt, status)
       VALUES ('sk_fallback_c', $1, 'basic', 10000, 1.0, 'active')`,
      [WALLET],
    );
    const v = await enforceCapacity(pool, { wallet: WALLET });
    expect(v.ok).toBe(true);
    expect(v.tier).toBe('basic'); // served by authorizeAndMeter, not the 'capacity' path
  });

  it('(b) no authorization AND no api_credits account → denies, not a silent bypass', async () => {
    const v = await enforceCapacity(pool, { wallet: UNFUNDED });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('account_not_found'); // legacy path denies unknown identity
  });

  it('(a) over-cap authorization → denies insufficient_capacity, does NOT fall through to api_credits', async () => {
    await seed({ consumed: CAP }); // authorization fully consumed (0 headroom < cost)
    // Same wallet ALSO has a funded api_credits account. The fallback must NOT
    // mask a real capacity denial by drawing api_credits instead.
    await pool.query(
      `INSERT INTO api_credits (api_key, wallet_address, tier, daily_limit, credits_usdt, status)
       VALUES ('sk_fallback_a', $1, 'basic', 10000, 1.0, 'active')`,
      [WALLET],
    );
    const before = await pool.query(`SELECT credits_usdt FROM api_credits WHERE api_key='sk_fallback_a'`);
    const v = await enforceCapacity(pool, { wallet: WALLET });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('insufficient_capacity'); // real denial, NOT no_authorization
    const after = await pool.query(`SELECT credits_usdt FROM api_credits WHERE api_key='sk_fallback_a'`);
    expect(String(after.rows[0].credits_usdt)).toBe(String(before.rows[0].credits_usdt)); // untouched
  });
});
