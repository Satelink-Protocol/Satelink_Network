// fix/dodo-rpc-boundary — Dodo-originated value (card/UPI via Dodo Payments)
// pays for Trading Intelligence ONLY. It must never pay for RPC or x402.
//
// Before the fix, /internal/dodo/credit (credit packs, and every
// subscription.renewed) called creditAccount(), which added the Dodo amount to
// api_credits.credits_usdt — the same balance the RPC gateway deducts. A
// Dodo-funded key could spend it on RPC.
//
// The boundary is enforced at the CONSUMPTION point, inside the atomic
// deduction: api_credits.dodo_funded_usdt ring-fences the unspent Dodo part of
// credits_usdt; RPC/x402 may only spend credits_usdt − dodo_funded_usdt;
// Trading Intelligence spends the Dodo part first.
//
// Real Postgres (the rule lives in SQL), inside one transaction that is rolled
// back — nothing persists. SKIPS without a local DATABASE_URL.
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('Dodo → RPC/x402 boundary (fix/dodo-rpc-boundary)', function () {
  this.timeout(30000);

  const KEY = 'sk_basic_dodo_boundary_test_00000000000000000000000000';
  const RPC_PRICE = 0.00003;
  let raw, connected = false;
  let creditAccount, authorizeAndMeter, createRpcGateway, initRouterWithPool, DODO_FUNDED_DDL;
  let realFetch, prevCanonical, prevRedis;

  before(async function () {
    if (!process.env.DATABASE_URL) this.skip();
    ({ creditAccount, authorizeAndMeter } = await import('../src/billing/credit_service.mjs'));
    ({ createRpcGateway } = await import('../src/workloads/rpc_gateway/rpc_gateway.js'));
    ({ initRouterWithPool } = await import('../src/workloads/rpc_gateway/router.js'));
    ({ DODO_FUNDED_DDL } = await import('../src/db/dodo_rail_schema.js'));
    const { default: pg } = await import('pg');
    raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try { await raw.connect(); connected = true; } catch { this.skip(); }
    await raw.query('BEGIN'); // rolled back in after()
    // Bring the local test schema to production shape for the columns used.
    await raw.query(`ALTER TABLE api_deposits ADD COLUMN IF NOT EXISTS credited_usdt NUMERIC(18,6)`);
    // Fallback lets this file reproduce the leak on a tree without the fix.
    await raw.query(DODO_FUNDED_DDL || `ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS dodo_funded_usdt NUMERIC(18,6) NOT NULL DEFAULT 0`);
    prevCanonical = process.env.CREDIT_CANONICAL;
    prevRedis = process.env.REDIS_URL;
    process.env.CREDIT_CANONICAL = 'true';
    delete process.env.REDIS_URL;
    realFetch = globalThis.fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (prevCanonical === undefined) delete process.env.CREDIT_CANONICAL; else process.env.CREDIT_CANONICAL = prevCanonical;
    if (prevRedis !== undefined) process.env.REDIS_URL = prevRedis;
    if (raw && connected) { await raw.query('ROLLBACK'); await raw.end(); }
  });

  beforeEach(async function () {
    if (!raw) this.skip();
    await raw.query('SAVEPOINT dodo_boundary');
    await raw.query(
      `INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, status) VALUES ($1, 'basic', 1000000, 0, 'active')`,
      [KEY]
    );
    globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x10' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  afterEach(async () => {
    if (!raw) return;
    await raw.query('ROLLBACK TO SAVEPOINT dodo_boundary');
    await raw.query('RELEASE SAVEPOINT dodo_boundary');
  });

  // Exactly what /internal/dodo/credit does for a credit pack or a renewal.
  const fundViaDodo = (amount, id) => creditAccount(raw, { apiKey: KEY, amountUsdt: amount, txHash: `dodo:${id}`, fromAddress: 'buyer@example.com', fundingSource: 'dodo' });
  // An on-chain USDT deposit (DepositListener / manual claim).
  const fundViaCrypto = (amount, id) => creditAccount(raw, { apiKey: KEY, amountUsdt: amount, txHash: `0x${id}` });
  const balances = async () => (await raw.query(`SELECT credits_usdt::float AS c, dodo_funded_usdt::float AS d FROM api_credits WHERE api_key = $1`, [KEY])).rows[0];

  function rpcCall() {
    const app = express();
    app.use(express.json());
    app.use('/rpc', createRpcGateway(raw));
    // Node routing is out of scope here, and the local test DB has no
    // registered_nodes table — a failed lookup would abort the shared
    // transaction. Providers (stubbed fetch) serve every call.
    initRouterWithPool(null);
    return request(app).post('/rpc/polygon').set('X-API-Key', KEY)
      .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
  }

  it('NEGATIVE: a Dodo-funded account calling RPC gets 402 and is not charged', async () => {
    expect((await fundViaDodo(10, 'pay_neg')).ok).to.equal(true);
    const res = await rpcCall();
    expect(res.status, JSON.stringify(res.body)).to.equal(402);
    expect(res.body.error).to.equal('insufficient_credits');
    const b = await balances();
    expect(b.c).to.equal(10);
    expect(b.d).to.equal(10);
  });

  it('NEGATIVE: authorizeAndMeter refuses RPC and x402-alias spend of Dodo value', async () => {
    await fundViaDodo(10, 'pay_meter');
    for (const product of ['rpc', 'x402']) {
      const v = await authorizeAndMeter(raw, { apiKey: KEY, product });
      expect(v.ok, product).to.equal(false);
      expect(v.http).to.equal(402);
    }
    expect((await balances()).c).to.equal(10);
  });

  it('POSITIVE: Trading Intelligence spends the Dodo value (Dodo part first)', async () => {
    await fundViaDodo(10, 'pay_ti');
    const v = await authorizeAndMeter(raw, { apiKey: KEY, product: 'intelligence', methodPrice: 0.01 });
    expect(v.ok).to.equal(true);
    const b = await balances();
    expect(b.c).to.be.closeTo(9.99, 1e-9);
    expect(b.d).to.be.closeTo(9.99, 1e-9);
  });

  it('MIXED: RPC may spend only the crypto-funded part', async () => {
    await fundViaDodo(10, 'pay_mixed');
    await fundViaCrypto(RPC_PRICE, 'aa');       // exactly one RPC call of crypto value
    expect((await rpcCall()).status).to.equal(200);
    let b = await balances();
    expect(b.c).to.be.closeTo(10, 1e-9);        // the crypto part was spent
    expect(b.d).to.equal(10);                   // the Dodo part is untouched
    expect((await rpcCall()).status).to.equal(402); // no crypto left → 402
    b = await balances();
    expect(b.c).to.be.closeTo(10, 1e-9);
  });

  it('crypto deposits are not ring-fenced (RPC unaffected)', async () => {
    await fundViaCrypto(1, 'bb');
    expect((await rpcCall()).status).to.equal(200);
    expect((await balances()).d).to.equal(0);
  });
});
