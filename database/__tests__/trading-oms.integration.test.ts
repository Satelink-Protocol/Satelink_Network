/**
 * Stage 17 — migration 027_oms up/down + PgOmsStore driving acceptance, dispatcher and
 * reconciler against Postgres (orders, order_events, trading_outbox) and the Stage 10 MockBroker.
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
  PgOmsStore, OrderAcceptanceService, OrderDispatcher, OrderReconciler, SimulatedCrash,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/oms/index.mjs';
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
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '027_oms.down.sql'), 'utf8');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const TERMS_HASH = `sha256:${'e'.repeat(64)}`;
const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });
const INTENT = (k: string) => ({ idempotencyKey: k, principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId: 'mdt_0001', origin: 'manual', approvedBy: 'prn_alice', mode: 'paper', venue: 'mock', instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '0.001' });

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('027_oms', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let store: InstanceType<typeof PgOmsStore>;
  let broker: InstanceType<typeof MockBroker>;
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  let n = 0;
  const mandates = { async verifyForOrder() { return { principalId: 'prn_alice', brokerAccountId: 'bka_0001', currency: 'USDT', decimals: 2, termsHash: TERMS_HASH }; } };
  const risk = { async decide() { return { decision: 'APPROVE', recorded: true, decisionId: `rdc_${++n}` }; } };
  const adapters = () => ({ forVenue: () => broker });
  const acceptance = () => new OrderAcceptanceService({ store, mandates, risk, venues: { capabilities: () => broker.capabilities() }, idFactory: (p: string) => `${p}_${Date.now()}${++n}`, clock });
  const dispatcher = (faults?: object) => new OrderDispatcher({ store: new PgOmsStore(pool), adapters: adapters(), mandates, clock, leaseMs: 30_000, submitTimeoutMs: 5_000, notFoundGraceMs: 60_000, ...(faults ? { faults } : {}) });

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_oms_${Date.now()}`;
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
    expect(result.applied).toContain('027_oms.sql');
    pool = new pg.Pool({ connectionString: conn, max: 8 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    await pool.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment, status) VALUES ('bka_0001', 'prn_alice', 'binance', 'paper', 'active')`);
    await pool.query(`INSERT INTO mandates (id, principal_id, broker_account_id, mode, status, max_notional_minor, currency, decimals) VALUES ('mdt_0001', 'prn_alice', 'bka_0001', 'copilot', 'draft', 100000, 'USDT', 2)`);
    store = new PgOmsStore(pool);
    broker = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' } });
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

  it('acceptance writes order + order_events + outbox in one transaction; dispatch places it', async () => {
    const a = await acceptance().accept(INTENT('idem_pg_00000001'));
    expect(a).toMatchObject({ accepted: true, status: 'approved' });
    const ob = (await pool.query(`SELECT event_type, idempotency_key, status FROM trading_outbox WHERE aggregate_id = $1`, [a.orderId])).rows;
    expect(ob).toEqual([{ event_type: 'order.place', idempotency_key: `place:${a.orderId}:0`, status: 'pending' }]);
    expect((await acceptance().accept(INTENT('idem_pg_00000001'))).duplicate).toBe(true);
    expect(await dispatcher().runOnce()).toBe('placed');
    const o = (await pool.query(`SELECT status, dispatch_count, broker_order_id FROM orders WHERE id = $1`, [a.orderId])).rows[0];
    expect(o).toMatchObject({ status: 'acknowledged', dispatch_count: 1 });
    expect(o.broker_order_id).toMatch(/^mock-ord-/);
    const evs = (await pool.query(`SELECT to_status FROM order_events WHERE order_id = $1 ORDER BY id`, [a.orderId])).rows.map((r) => r.to_status);
    expect(evs).toEqual(['approved', 'submitted', 'acknowledged']);
  });

  it('concurrent dispatchers (separate connections, SKIP LOCKED) send one order per event, once', async () => {
    const ids = [];
    for (let i = 0; i < 6; i += 1) ids.push((await acceptance().accept(INTENT(`idem_pg_conc_${i}0000`))).orderId);
    for (const id of ids.slice(0, 3)) await pool.query(`INSERT INTO trading_outbox (aggregate_type, aggregate_id, event_type, payload, idempotency_key) VALUES ('order', $1, 'order.place', '{}', $2)`, [id, `place:${id}:dup`]);
    const outs = await Promise.all(Array.from({ length: 12 }, () => dispatcher().runOnce()));
    // SKIP LOCKED lets a claimer come back empty while rows are locked; drain the rest sequentially.
    for (let x = await dispatcher().runOnce(); x !== null; x = await dispatcher().runOnce()) outs.push(x);
    expect(outs.filter((x) => x === 'placed')).toHaveLength(6);
    expect(outs.filter((x) => x !== null && x !== 'placed').every((x) => x === 'noop' || x === 'concurrent')).toBe(true); // duplicate events: idempotent
    const st = (await pool.query(`SELECT status, dispatch_count FROM orders WHERE id = ANY($1)`, [ids])).rows;
    expect(st.every((r) => r.status === 'acknowledged' && r.dispatch_count === 1)).toBe(true);
    for (const id of ids) {
      const cid = (await pool.query(`SELECT client_order_id FROM orders WHERE id = $1`, [id])).rows[0].client_order_id;
      expect((await broker.getOrder('bka_0001', { clientOrderId: cid })).clientOrderId).toBe(cid);
    }
  });

  it('crash after the broker accepted: the lease expires, the order is reconciled, not resent', async () => {
    const a = await acceptance().accept(INTENT('idem_pg_crash0001'));
    const faults = { fired: false, crash(p: string) { if (p === 'after_broker_call' && !this.fired) { this.fired = true; throw new SimulatedCrash(p); } } };
    await expect(dispatcher(faults).runOnce()).rejects.toBeInstanceOf(SimulatedCrash);
    expect((await pool.query(`SELECT status FROM orders WHERE id = $1`, [a.orderId])).rows[0].status).toBe('submitted');
    expect(await dispatcher().runOnce()).toBeNull(); // lease held
    t.now += 31_000;
    expect(await dispatcher().runOnce()).toBe('reconciled');
    expect((await pool.query(`SELECT status, dispatch_count FROM orders WHERE id = $1`, [a.orderId])).rows[0]).toEqual({ status: 'acknowledged', dispatch_count: 1 });
  });

  it('UNKNOWN after an ambiguous submit is resolved by the reconciler from venue history', async () => {
    const a = await acceptance().accept(INTENT('idem_pg_unknown01'));
    broker = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' }, scenarios: { [a.clientOrderId]: MockScenario.TIMEOUT_AFTER_ACCEPT } });
    expect(await dispatcher().runOnce()).toBe('unknown');
    const u = (await pool.query(`SELECT status, unknown_since FROM orders WHERE id = $1`, [a.orderId])).rows[0];
    expect(u.status).toBe('unknown');
    expect(u.unknown_since).not.toBeNull();
    t.now += 40_000;
    await new OrderReconciler({ store, adapters: adapters(), clock, sentGraceMs: 30_000, notFoundGraceMs: 60_000 }).runOnce();
    expect((await pool.query(`SELECT status FROM orders WHERE id = $1`, [a.orderId])).rows[0].status).toBe('acknowledged');
  });

  it('the trigger enforces the transition table, immutable identity, frozen terminal orders and no deletes', async () => {
    const a = await acceptance().accept(INTENT('idem_pg_trigger01'));
    const id = a.orderId;
    await expect(pool.query(`UPDATE orders SET status = 'filled' WHERE id = $1`, [id])).rejects.toThrow(/illegal status transition approved -> filled/);
    await expect(pool.query(`UPDATE orders SET client_order_id = 'sl-new-id-0000000' WHERE id = $1`, [id])).rejects.toThrow(/identity columns are immutable/);
    await expect(pool.query(`UPDATE orders SET quantity = 5 WHERE id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM orders WHERE id = $1`, [id])).rejects.toThrow(/cannot be deleted/);
    await expect(pool.query(`UPDATE orders SET status = 'unknown' WHERE id = $1`, [id])).rejects.toThrow(/illegal status transition/);
    await pool.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [id]); // Stage 16 revocation edge (approved → cancelled)
    await expect(pool.query(`UPDATE orders SET last_error = 'x' WHERE id = $1`, [id])).rejects.toThrow(/is terminal/);
    const b = await acceptance().accept(INTENT('idem_pg_trigger02'));
    await pool.query(`UPDATE orders SET status = 'submitted' WHERE id = $1`, [b.orderId]);
    await expect(pool.query(`UPDATE orders SET status = 'unknown' WHERE id = $1`, [b.orderId])).rejects.toThrow(/orders_unknown_has_since/);
    await pool.query(`UPDATE orders SET status = 'cancel_requested' WHERE id = $1`, [b.orderId]); // Stage 16 edge (submitted → cancel_requested)
    await pool.query(`UPDATE orders SET filled_quantity = 0.0005 WHERE id = $1`, [b.orderId]);
    await expect(pool.query(`UPDATE orders SET filled_quantity = 0.0001 WHERE id = $1`, [b.orderId])).rejects.toThrow(/cannot decrease/);
    await expect(pool.query(`UPDATE orders SET filled_quantity = 5 WHERE id = $1`, [b.orderId])).rejects.toThrow(/orders_fill_within_quantity/);
  });

  it('down migration restores the 021 shape', async () => {
    await pool.query(`DELETE FROM trading_outbox`); // ephemeral test DB; outbox rows are not protected
    await pool.query(`ALTER TABLE orders DISABLE TRIGGER oms_orders_guard`);
    await pool.query(`UPDATE orders SET status = 'cancelled' WHERE status = 'unknown'`);
    await pool.query(`ALTER TABLE orders ENABLE TRIGGER oms_orders_guard`);
    await pool.query(DOWN_SQL);
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('dispatch_count', 'unknown_since', 'venue')`)).rowCount;
    expect(cols).toBe(0);
    await expect(pool.query(`UPDATE orders SET status = 'unknown' WHERE false`)).resolves.toBeDefined();
    await expect(pool.query(`INSERT INTO orders (id, principal_id, mandate_id, broker_account_id, client_order_id, instrument, side, order_type, quantity, mode, status, idempotency_key)
      VALUES ('ord_x', 'prn_alice', 'mdt_0001', 'bka_0001', 'cx-0000000001', 'BTC-USDT', 'buy', 'market', 1, 'paper', 'unknown', 'ix-1')`)).rejects.toThrow(/orders_status_check/);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '027_oms.sql'`)).rowCount).toBe(0);
  });
});
