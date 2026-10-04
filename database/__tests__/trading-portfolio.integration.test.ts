/**
 * Stage 18 — migration 028_portfolio up/down + PgPortfolioStore end to end:
 * OMS (PgOmsStore + MockBroker) → FillConsumer → fills/positions → snapshot →
 * reconciliation mismatch → Stage 15 kill switch (PgRiskStore) + strategy.auto_paused.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB
 * pointing at a LOCAL server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import {
  PgPortfolioStore, FillConsumer, PortfolioSnapshotter, PortfolioReconciler,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/portfolio/index.mjs';
import {
  PgOmsStore, OrderAcceptanceService, OrderDispatcher,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/oms/index.mjs';
import {
  PgRiskStore, KillSwitchService,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/risk/index.mjs';
import {
  MockBroker, MockScenario,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/brokers/mock_broker.mjs';
import {
  InstrumentRegistry, defineInstrument,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/brokers/symbols.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '028_portfolio.down.sql'), 'utf8');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('028_portfolio', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  let n = 0;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_portfolio_${Date.now()}`;
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
    expect(result.applied).toContain('028_portfolio.sql');
    pool = new pg.Pool({ connectionString: conn, max: 6 });
    for (const p of ['prn_alice', 'prn_bob']) await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ($1, 'human', $1, 'active')`, [p]);
    await pool.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment, status) VALUES ('bka_0001', 'prn_alice', 'binance', 'paper', 'active'), ('bka_0002', 'prn_bob', 'binance', 'paper', 'active')`);
    await pool.query(`INSERT INTO mandates (id, principal_id, broker_account_id, mode, status, max_notional_minor, currency, decimals) VALUES ('mdt_0001', 'prn_alice', 'bka_0001', 'copilot', 'draft', 100000, 'USDT', 2)`);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await a.end();
    }
  });

  it('OMS fills flow into fills (no ledger link) and a recomputed position; snapshot and reconciliation persist; auto-pause halts the account', async () => {
    const oms = new PgOmsStore(pool);
    // MockBroker copies its scenario map at construction, so fill-on-accept is set as the default.
    const broker = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' }, defaultScenario: MockScenario.FILL });
    const adapters = { forVenue: () => broker };
    const mandates = { async verifyForOrder() { return { principalId: 'prn_alice', brokerAccountId: 'bka_0001', currency: 'USDT', decimals: 2, termsHash: `sha256:${'e'.repeat(64)}` }; } };
    const acceptance = new OrderAcceptanceService({ store: oms, mandates, risk: { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: `rdc_${++n}` }; } }, venues: { capabilities: () => broker.capabilities() }, idFactory: (p: string) => `${p}_${Date.now()}${++n}`, clock });
    const dispatcher = new OrderDispatcher({ store: oms, adapters, mandates, clock });
    for (const [k, side, q] of [['idem_pt_0001', 'buy', '0.003'], ['idem_pt_0002', 'sell', '0.001']]) {
      const a = await acceptance.accept({ idempotencyKey: k, principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId: 'mdt_0001', origin: 'manual', approvedBy: 'prn_alice', mode: 'paper', venue: 'mock', instrument: 'BTC-USDT', side, type: 'market', quantity: q });
      expect(a.accepted).toBe(true);
      expect(await dispatcher.runOnce()).toBe('placed');
    }

    const store = new PgPortfolioStore(pool);
    const consumer = new FillConsumer({ store, adapters, clock });
    expect((await consumer.runOnce()).fillsInserted).toBe(2);
    expect((await consumer.runOnce()).fillsInserted).toBe(0);
    const fills = (await pool.query(`SELECT ledger_txn_id, fee_currency, fee_minor::text AS fee FROM fills ORDER BY executed_at`)).rows;
    expect(fills).toEqual([{ ledger_txn_id: null, fee_currency: 'USDT', fee: '9' }, { ledger_txn_id: null, fee_currency: 'USDT', fee: '3' }]);
    const [pos] = await store.positions('prn_alice', { brokerAccountId: 'bka_0001', mode: 'paper' });
    expect(pos).toMatchObject({ quantity: '0.002', avgEntryPrice: '30000', realizedPnlMinor: '-12', feesMinor: '12', fillCount: 2 });
    expect(await store.positions('prn_bob')).toEqual([]); // tenant filter

    const snap = await new PortfolioSnapshotter({ store, marks: { async mark() { return { price: '31000', stale: false }; } }, clock }).take({ principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' });
    expect(snap).toMatchObject({ unrealizedPnlMinor: '200', marksComplete: true });
    expect((await store.snapshots('prn_alice'))[0].snapshotHash).toBe(snap.snapshotHash);

    const riskStore = new PgRiskStore(pool);
    const killSwitches = new KillSwitchService({ store: riskStore, clock });
    const reconciler = new PortfolioReconciler({
      store, killSwitches, clock, mismatchesToPause: 2, tolerance: { defaultQty: '0.0001' },
      accounts: { async get(id: string) { return { bka_0001: { principalId: 'prn_alice' }, bka_0002: { principalId: 'prn_bob' } }[id] ?? null; } },
      brokerPositions: { async snapshot() { return { asOf: clock().toISOString(), positions: [{ instrument: 'BTC-USDT', quantity: '0.0025' }] }; } },
    });
    const args = { principalId: 'prn_alice', brokerAccountId: 'bka_0001', mode: 'paper' };
    expect((await reconciler.runOnce(args)).action).toBe('none');
    t.now += 60_000;
    expect((await reconciler.runOnce(args)).action).toBe('paused');
    const ks = (await pool.query(`SELECT scope_type, scope_id, principal_id, action, source FROM kill_switch_events`)).rows;
    expect(ks).toEqual([{ scope_type: 'broker_account', scope_id: 'bka_0001', principal_id: 'prn_alice', action: 'engage', source: 'system' }]);
    const ob = (await pool.query(`SELECT aggregate_type, event_type, status FROM trading_outbox WHERE aggregate_type = 'strategy'`)).rows;
    expect(ob).toEqual([{ aggregate_type: 'strategy', event_type: 'strategy.auto_paused', status: 'pending' }]);
    expect(await dispatcher.runOnce()).toBeNull(); // the OMS dispatcher only claims 'order' events
    expect((await pool.query(`SELECT action FROM audit_events WHERE action = 'strategy.auto_paused'`)).rowCount).toBe(1);
    const ev = (await store.reconciliationEvents('prn_alice', { brokerAccountId: 'bka_0001' })).map((e: { status: string; action: string; consecutiveMismatches: number }) => [e.status, e.consecutiveMismatches, e.action]);
    expect(ev).toEqual([['mismatch', 2, 'paused'], ['mismatch', 1, 'none']]);
    expect(await store.reconciliationEvents('prn_bob')).toEqual([]);
  });

  it('append-only history and integrity CHECKs', async () => {
    const g = (await pool.query(`SELECT has_table_privilege('public', 'portfolio_snapshots', 'UPDATE') AS su, has_table_privilege('public', 'reconciliation_events', 'DELETE') AS rd`)).rows[0];
    expect(g).toEqual({ su: false, rd: false });
    await expect(pool.query(`UPDATE positions SET avg_entry_price = NULL WHERE quantity <> 0`)).rejects.toThrow(/positions_flat_has_no_avg/);
    await expect(pool.query(`INSERT INTO reconciliation_events (id, principal_id, broker_account_id, mode, checked_at, status, consecutive_mismatches, action, tolerance, details)
      VALUES ('rce_bad1', 'prn_alice', 'bka_0001', 'paper', now(), 'match', 0, 'paused', '{}', '{}')`)).rejects.toThrow(/check constraint/);
    await expect(pool.query(`INSERT INTO portfolio_snapshots (id, principal_id, broker_account_id, mode, taken_at, currency, decimals, positions, realized_pnl_minor, unrealized_pnl_minor, marks_complete, snapshot_hash)
      VALUES ('pfs_bad1', 'prn_alice', 'bka_0001', 'paper', now(), 'USDT', 2, '[]', 0, NULL, true, $1)`, [`sha256:${'0'.repeat(64)}`])).rejects.toThrow(/check constraint/);
  });

  it('down migration removes the 028 tables and columns', async () => {
    await pool.query(DOWN_SQL);
    for (const tname of ['portfolio_snapshots', 'reconciliation_events', 'portfolio_consumer_cursors']) {
      expect((await pool.query(`SELECT to_regclass($1) AS t`, [`public.${tname}`])).rows[0].t).toBeNull();
    }
    expect((await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'positions' AND column_name IN ('fees_minor', 'fill_count')`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '028_portfolio.sql'`)).rowCount).toBe(0);
  });
});
