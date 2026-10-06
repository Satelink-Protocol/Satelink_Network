/**
 * Stage 19 — migration 029 (append-only for every role + trace stamping) and a FULL traced
 * MockBroker trade: agent run (Stage 12) → signed mandate (16) → risk decision (15) → order (17)
 * → dispatch + fills by untraced workers (17, 18) → "Why did Satelink do this?" receipt.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB
 * pointing at a LOCAL server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { tracedPool, runWithTrace, newTrace, TradeReceiptAssembler, PgReceiptSource } from '../../apps/api/src/trading_agent/audit/index.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { ToolRegistry, createDefaultTools, ScriptedProvider, ModelRouter, TraceRecorder, PgTraceStore, AgentRunner } from '../../apps/api/src/trading_agent/agent/index.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { MandateService, PgMandateStore } from '../../apps/api/src/trading_agent/authorization/index.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { RiskEngine, PgRiskStore } from '../../apps/api/src/trading_agent/risk/index.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { PgOmsStore, OrderAcceptanceService, OrderDispatcher } from '../../apps/api/src/trading_agent/oms/index.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { PgPortfolioStore, FillConsumer } from '../../apps/api/src/trading_agent/portfolio/index.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { MockBroker, MockScenario } from '../../apps/api/src/trading_agent/brokers/mock_broker.mjs';
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { InstrumentRegistry, defineInstrument } from '../../apps/api/src/trading_agent/brokers/symbols.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '029_audit_trail.down.sql'), 'utf8');
const T0 = Date.UTC(2026, 9, 6, 9, 0);
const SPEC = defineInstrument({ canonical: 'BTC-USDT', venue: 'mock', venueSymbol: 'BTCUSDT', quoteCurrency: 'USDT', quoteDecimals: 2, tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '1' });
const SECRET = ['sk', 'ant', 'api03', 'Qq1Ww2Ee3Rr4Tt5Yy6Uu7'].join('-');
const GUARDED = ['audit_events', 'order_events', 'fills', 'strategy_versions', 'tool_calls', 'model_traces', 'kill_switch_events', 'reconciliation_events', 'portfolio_snapshots'];

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('029_audit_trail', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  const t = { now: T0 };
  const clock = () => new Date(t.now);
  let n = 0;
  const ids = (p: string) => `${p}_${String(++n).padStart(6, '0')}`;
  let orderId = '';
  let traceId = '';

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_audit_${Date.now()}`;
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
    expect(result.applied).toContain('029_audit_trail.sql');
    pool = new pg.Pool({ connectionString: conn, max: 6 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    await pool.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment, status) VALUES ('bka_0001', 'prn_alice', 'binance', 'paper', 'active')`);
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

  it('a MockBroker trade carries ONE trace from agent run to fills, and the receipt is complete', async () => {
    const traced = tracedPool(pool);
    const broker = new MockBroker({ credentialLoader: { async load() { return {}; } }, instruments: new InstrumentRegistry([SPEC]), clock, marketPrices: { 'BTC-USDT': '30000' }, defaultScenario: MockScenario.FILL });

    // Authority first (its own action, not part of the trade's trace): a user-signed mandate.
    const mandates = new MandateService({
      store: new PgMandateStore(traced), signer: { keyId: 'it-k1', secret: Buffer.alloc(32, 5) }, clock, idFactory: ids,
      stepUp: { async availability() { return { available: true }; }, async verify() { return { ok: true, method: 'totp', userId: 'u1' }; } },
      accounts: { async get() { return { id: 'bka_0001', principalId: 'prn_alice', broker: 'mock', environment: 'paper', status: 'active' }; } },
    });
    const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
    const p = await mandates.propose({ actor: alice, principalId: 'prn_alice', draft: { brokerAccountId: 'bka_0001', environment: 'paper', mode: 'A', strategy: null, instruments: ['BTC-USDT'], limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000' }, validUntil: new Date(T0 + 30 * 86_400_000).toISOString() } });
    await mandates.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code: '123456' });
    t.now += 60_000;

    const trace = newTrace();
    traceId = trace.traceId;
    let proposal: { payload: Record<string, string> } | null = null;
    await runWithTrace(trace, async () => {
      // 1. Agent run: the model proposes (it cannot place). The goal carries a secret on purpose.
      const registry = new ToolRegistry({ read: {}, proposals: { async create(x: { payload: Record<string, string> }) { proposal = x; return { proposalId: 'prp_000001', status: 'pending_review' }; } } });
      for (const tool of createDefaultTools()) registry.register(tool);
      const provider = new ScriptedProvider({ id: 'scripted', script: [
        { toolCalls: [{ id: 'c1', name: 'propose_order', arguments: JSON.stringify({ mandateId: p.mandateId, instrument: 'BTC-USDT', side: 'buy', type: 'market', quantity: '0.002', rationale: 'Momentum continuation on 1h; within mandate limits.' }) }] },
        { content: 'Proposed a 0.002 BTC market buy for your approval.' },
      ] });
      const runner = new AgentRunner({ registry, router: new ModelRouter({ routes: { chat: [{ provider: 'scripted', model: 's-1' }] }, providers: { scripted: provider } }), tracer: new TraceRecorder({ store: new PgTraceStore(traced), clock, idFactory: ids }) });
      await runner.run({ principalId: 'prn_alice', goal: `Buy a little BTC if momentum holds. (my api key is ${SECRET})` });
      expect(proposal).not.toBeNull();

      // 2. The owner approves the proposal → acceptance (mandate + risk + order, one transaction).
      const ctxFor = async (o: Record<string, string>) => ({
        now: t.now, flagsEnv: { TRADING_FLAG_TRADING_AGENT: 'true' },
        policy: { id: 'rsk_1', version: 1, hash: `sha256:${'a'.repeat(64)}`, currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2', maxOpenPositions: 3, allowedInstruments: ['BTC-USDT'], killSwitch: false,
          limits: { maxPositionNotionalMinor: '200000', maxPriceDeviationBps: 100, maxQuoteAgeMs: 5000, maxOrdersPerMinute: 10, maxOrdersPerDay: 200, duplicateWindowMs: 2000, allowShort: false, breakers: { maxConsecutiveLosses: 5, maxConsecutiveRejects: 10, maxBrokerErrors: 5 } } },
        killSwitchEvents: [], brokerAccount: { id: 'bka_0001', principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'active' },
        mandate: await mandates.verifyForOrder(o.mandateId), strategy: null,
        instrument: { canonical: 'BTC-USDT', venue: 'mock', tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5', quoteCurrency: 'USDT' },
        quote: { instrument: 'BTC-USDT', bid: '29990', ask: '30010', sourceTime: t.now - 500, stale: false },
        account: { equityMinor: '1000000', cashAvailableMinor: '800000', grossExposureMinor: '0' },
        activity: { idempotencyKeyUsed: false, ordersLastMinute: 0, ordersToday: 0, todayNotionalMinor: '0', realizedPnlTodayMinor: '0', unrealizedPnlMinor: '0', openPositions: [], lastSimilarOrderAt: null, consecutiveLosses: 0, consecutiveRejects: 0, brokerErrorsInWindow: 0 },
      });
      const risk = new RiskEngine({ loadContext: ctxFor, store: new PgRiskStore(traced), clock, idFactory: ids });
      const acceptance = new OrderAcceptanceService({ store: new PgOmsStore(traced), mandates, risk, venues: { capabilities: () => broker.capabilities() }, idFactory: ids, clock });
      const prop = (proposal as unknown as { payload: Record<string, string> }).payload;
      const a = await acceptance.accept({ idempotencyKey: 'idem_audit_000001', principalId: 'prn_alice', brokerAccountId: 'bka_0001', mandateId: prop.mandateId, origin: 'llm_proposal', approvedBy: 'prn_alice', mode: 'paper', venue: 'mock', instrument: prop.instrument, side: prop.side, type: prop.type, quantity: prop.quantity });
      expect(a.accepted).toBe(true);
      orderId = a.orderId;
    });

    // 3. Workers run later, OUTSIDE the trace context, on the raw pool: their rows inherit the order's trace.
    const adapters = { forVenue: () => broker };
    t.now += 1_000;
    expect(await new OrderDispatcher({ store: new PgOmsStore(pool), adapters, mandates, clock }).runOnce()).toBe('placed');
    expect((await new FillConsumer({ store: new PgPortfolioStore(pool), adapters, clock }).runOnce()).fillsInserted).toBe(1);

    const traceOf = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows.map((r) => r.trace_id);
    expect(await traceOf(`SELECT trace_id FROM agent_runs`, [])).toEqual([traceId]);
    expect(new Set(await traceOf(`SELECT trace_id FROM tool_calls`, []))).toEqual(new Set([traceId]));
    expect(new Set(await traceOf(`SELECT trace_id FROM model_traces`, []))).toEqual(new Set([traceId]));
    expect(await traceOf(`SELECT trace_id FROM audit_events WHERE action = 'risk.decision'`, [])).toEqual([traceId]);
    expect(await traceOf(`SELECT trace_id FROM orders WHERE id = $1`, [orderId])).toEqual([traceId]);
    expect(new Set(await traceOf(`SELECT trace_id FROM order_events WHERE order_id = $1`, [orderId]))).toEqual(new Set([traceId]));
    expect(await traceOf(`SELECT trace_id FROM fills`, [])).toEqual([traceId]);
    expect((await pool.query(`SELECT trace_id FROM audit_events WHERE action LIKE 'mandate.%'`)).rows.every((r) => r.trace_id === null)).toBe(true); // separate, earlier action
    const spans = (await pool.query(`SELECT o.span_id AS order_span, e.parent_span_id AS event_parent FROM orders o JOIN order_events e ON e.order_id = o.id WHERE o.id = $1 AND e.event_type = 'dispatch'`, [orderId])).rows[0];
    expect(spans.event_parent).toBe(spans.order_span); // worker rows are children of the order span

    // 4. "Why did Satelink do this?"
    const receipt = await new TradeReceiptAssembler({ source: new PgReceiptSource(pool), clock }).explainOrder({ principalId: 'prn_alice', orderId });
    expect(receipt.completeness).toMatchObject({ complete: true, missing: [] });
    expect(receipt).toMatchObject({ traceId, orderId });
    expect(receipt.why.origin).toBe('agent');
    expect(receipt.why.agentRuns[0].toolCalls.map((x: { tool: string }) => x.tool)).toEqual(['propose_order']);
    expect(receipt.why.mandate).toMatchObject({ mode: 'A', matchesOrder: true, stepUpMethod: 'totp' });
    expect(receipt.why.risk).toMatchObject({ decision: 'APPROVE', checksPassed: 20, checksTotal: 20 });
    expect(receipt.what).toMatchObject({ status: 'filled', filledQuantity: '0.002' });
    expect(receipt.ledger).toMatchObject({ posted: false });
    expect(JSON.stringify(receipt)).not.toContain(SECRET); // redacted at write (Stage 12) and again in the receipt
    if (process.env.DUMP_RECEIPT) writeFileSync(process.env.DUMP_RECEIPT, JSON.stringify(receipt, null, 2));

    // pooled connections never keep a stale trace
    const c = await pool.connect();
    const leaked = (await c.query(`SELECT current_setting('satelink.trace_id', true) AS t`)).rows[0].t;
    c.release();
    expect(leaked === null || leaked === '').toBe(true);
  });

  it('audit tables are append-only for EVERY role, superuser included (UPDATE, DELETE, TRUNCATE)', async () => {
    const su = (await pool.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0].rolsuper;
    expect(su).toBe(true); // this test connects as a superuser: REVOKE alone would not stop it
    // rows exist in these tables from the trade: every mutation must be refused
    for (const table of ['audit_events', 'order_events', 'fills', 'tool_calls', 'model_traces']) {
      const col = { audit_events: 'action', order_events: 'actor', fills: 'quantity', tool_calls: 'seq', model_traces: 'seq' }[table];
      await expect(pool.query(`UPDATE ${table} SET ${col} = ${col}`), `${table} UPDATE`).rejects.toThrow(/append-only/);
      await expect(pool.query(`DELETE FROM ${table}`), `${table} DELETE`).rejects.toThrow(/append-only/);
    }
    for (const table of GUARDED) {
      await expect(pool.query(`TRUNCATE ${table} CASCADE`), `${table} TRUNCATE`).rejects.toThrow(/append-only/);
    }
    // existing roles are untouched: satelink_app still may INSERT and SELECT
    const priv = (await pool.query(`SELECT has_table_privilege('satelink_app', 'audit_events', 'INSERT') AS i, has_table_privilege('satelink_app', 'audit_events', 'SELECT') AS s, has_table_privilege('satelink_app', 'audit_events', 'UPDATE') AS u`)).rows[0];
    expect(priv).toEqual({ i: true, s: true, u: false });
    await pool.query(`INSERT INTO audit_events (actor_type, actor_id, action) VALUES ('system', 'it', 'audit.insert_still_works')`); // INSERT unaffected
  });

  it('down migration removes the guards, the trace columns and the functions', async () => {
    await pool.query(DOWN_SQL);
    expect((await pool.query(`SELECT 1 FROM pg_trigger WHERE tgname LIKE '%\\_append\\_only' OR tgname LIKE '%\\_trace'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'trace_id'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM pg_proc WHERE proname LIKE 'trading\\_%'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '029_audit_trail.sql'`)).rowCount).toBe(0);
  });
});
