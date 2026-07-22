// /vnext/resell — THE inbound revenue leg, end to end. Caller pays Satelink
// price P; Satelink pays supplier cost C; treasury grows by P-C. Uses a LOCAL
// mock x402 merchant + injected mock inbound-verifier and outbound-signer (no
// real network/money) and the local vnext_m6_test DB (never prod).
// Run: `node --test test/vnext_resell_endpoint.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';

import { createVnextKernelRouter } from '../src/vnext/http/kernel_router.js';

const LOCAL_DSN = 'postgresql:///vnext_m6_test?host=/tmp';
const silent = { log() {}, error() {} };

function listen(app) { return new Promise((r) => { const s = app.listen(0, () => r({ server: s, port: s.address().port })); }); }

function mockMerchant() {
  const app = express();
  app.get('/x402/data', (req, res) => {
    if (!req.headers['x-payment']) return res.status(402).json({ x402Version: 1, accepts: { scheme: 'exact', network: 'eip155:8453', payTo: '0xMerchant', maxAmountRequired: '1000', resource: '/x402/data', mimeType: 'application/json' } });
    res.status(200).json({ ok: true, data: 'premium' });
  });
  return app;
}

async function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) { prev[k] = process.env[k]; if (overrides[k] === undefined) delete process.env[k]; else process.env[k] = overrides[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(overrides)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

async function pgOrSkip(t) {
  try { const pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 3 }); await pool.query('SELECT 1'); return pool; }
  catch { t.skip('local postgres unavailable'); return null; }
}

// Mock inbound verifier: accepts any header, reports settled at the quoted price.
const inboundVerifier = async ({ price }) => ({ settled: true, amount: price, txRef: '0xINBOUND', payer: '0xCaller' });
// Mock outbound signer so the upstream buy succeeds against the mock merchant.
const outboundSigner = { sign: async () => ({ payment: { signed: true }, ref: '0xOUTBOUND' }) };

test('resell: 402 challenge then paid fulfilment grows treasury by the spread', async (t) => {
  const pool = await pgOrSkip(t); if (!pool) return;
  const { server: mSrv, port: mPort } = await listen(mockMerchant());
  try {
    const resourceUrl = `http://127.0.0.1:${mPort}/x402/data`;
    await withEnv({
      VNEXT_KERNEL_ENABLED: 'true', VNEXT_SUBMIT_ENABLED: 'true',
      VNEXT_X402_RESOURCES: JSON.stringify([{ url: resourceUrl, method: 'GET', supplierId: 'merchant-1' }]),
      VNEXT_FEE_BPS: '250',                 // spread = 2.5% of cost
      VNEXT_OUTBOUND_ENABLED: 'true', VNEXT_OUTBOUND_MAX_PER_TX: '100000',
      VNEXT_INBOUND_PAYTO: '0xSatelink',
    }, async () => {
      await pool.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq, vnext_outbound, vnext_treasury').catch(() => {});
      const app = express();
      app.use('/vnext', createVnextKernelRouter(pool, { logger: silent, inboundVerifier, outboundSigner }));
      const { server, port } = await listen(app);
      try {
        // (1) No X-PAYMENT -> 402 challenge for price = cost(1000) + spread(25) = 1025.
        const c = await fetch(`http://127.0.0.1:${port}/vnext/resell`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resourceId: 'merchant-1', idempotencyKey: 'sale-1' }) });
        assert.equal(c.status, 402);
        const cb = await c.json();
        assert.equal(cb.price, '1025');
        assert.equal(cb.cost, '1000');
        assert.equal(cb.spread, '25');
        assert.equal(cb.accepts.payTo, '0xSatelink'); // caller pays SATELINK, not the merchant

        // (2) Retry WITH payment -> collect, pay supplier, serve goods.
        const r = await fetch(`http://127.0.0.1:${port}/vnext/resell`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': 'paid-proof' }, body: JSON.stringify({ resourceId: 'merchant-1', idempotencyKey: 'sale-1' }) });
        const b = await r.json();
        assert.equal(b.ok, true, `resell not CLOSED: ${JSON.stringify(b)}`);
        assert.equal(b.collected, '1025');
        assert.equal(b.cost, '1000');
        assert.equal(b.revenue, '25');          // <-- REAL SPREAD BOOKED
        assert.equal(b.result.status, 200);     // caller got the goods

        // (3) Treasury grew by the spread — verified from the durable table.
        const tq = await pool.query("SELECT COUNT(*)::int n, COALESCE(SUM(spread::numeric),0)::text s FROM vnext_treasury WHERE unit='USDC'");
        assert.equal(tq.rows[0].n, 1);
        assert.equal(tq.rows[0].s, '25');

        // (4) Idempotent: same key does not double-book revenue.
        const r2 = await fetch(`http://127.0.0.1:${port}/vnext/resell`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': 'paid-proof' }, body: JSON.stringify({ resourceId: 'merchant-1', idempotencyKey: 'sale-1' }) });
        const b2 = await r2.json();
        assert.equal(b2.deduped, true);
        const tq2 = await pool.query("SELECT COUNT(*)::int n, COALESCE(SUM(spread::numeric),0)::text s FROM vnext_treasury WHERE unit='USDC'");
        assert.equal(tq2.rows[0].n, 1);         // still one row
        assert.equal(tq2.rows[0].s, '25');      // revenue unchanged
      } finally { server.close(); }
    });
  } finally { await pool.end(); mSrv.close(); }
});

test('resell: without an inbound verifier, payment cannot settle (fail-safe, no free service)', async (t) => {
  const pool = await pgOrSkip(t); if (!pool) return;
  const { server: mSrv, port: mPort } = await listen(mockMerchant());
  try {
    const resourceUrl = `http://127.0.0.1:${mPort}/x402/data`;
    await withEnv({
      VNEXT_KERNEL_ENABLED: 'true', VNEXT_SUBMIT_ENABLED: 'true',
      VNEXT_X402_RESOURCES: JSON.stringify([{ url: resourceUrl, method: 'GET', supplierId: 'merchant-1' }]),
      VNEXT_FEE_BPS: '250',
    }, async () => {
      await pool.query('TRUNCATE vnext_treasury').catch(() => {});
      const app = express();
      app.use('/vnext', createVnextKernelRouter(pool, { logger: silent })); // NO inboundVerifier
      const { server, port } = await listen(app);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/vnext/resell`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': 'paid-proof' }, body: JSON.stringify({ resourceId: 'merchant-1', idempotencyKey: 'nofac-1' }) });
        assert.equal(r.status, 402); // cannot settle -> re-challenge, no goods, no revenue
        const b = await r.json();
        assert.equal(b.reason, 'no_verifier');
        const tq = await pool.query('SELECT COUNT(*)::int n FROM vnext_treasury');
        assert.equal(tq.rows[0].n, 0);
      } finally { server.close(); }
    });
  } finally { await pool.end(); mSrv.close(); }
});
