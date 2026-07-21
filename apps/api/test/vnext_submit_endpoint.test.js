// vNext /submit endpoint — x402 purchase workload through the durable kernel.
// Uses a LOCAL mock x402 merchant (no real network/money) and the local
// vnext_m6_test DB (never prod DATABASE_URL). Skips if PG is unavailable.
// Run: `node --test test/vnext_submit_endpoint.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';

import { createVnextKernelRouter } from '../src/vnext/http/kernel_router.js';

const LOCAL_DSN = 'postgresql:///vnext_m6_test?host=/tmp';
const silent = { log() {}, error() {} };

function listen(app) {
  return new Promise((resolve) => { const s = app.listen(0, () => resolve({ server: s, port: s.address().port })); });
}

// Minimal x402 merchant: 402 with an accepts challenge until an X-PAYMENT header
// is present, then 200 with goods.
function mockMerchant() {
  const app = express();
  let served = 0;
  app.get('/x402/data', (req, res) => {
    if (!req.headers['x-payment']) {
      return res.status(402).json({ x402Version: 1, accepts: { scheme: 'exact', network: 'eip155:8453', payTo: '0xMerchant', maxAmountRequired: '1000', resource: '/x402/data', mimeType: 'application/json' } });
    }
    served += 1;
    res.status(200).json({ ok: true, data: 'premium', served });
  });
  return app;
}

async function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) { prev[k] = process.env[k]; if (overrides[k] === undefined) delete process.env[k]; else process.env[k] = overrides[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(overrides)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

async function pgOrSkip(t) {
  try { const pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 3 }); await pool.query('SELECT 1'); return pool; }
  catch { t.skip('local postgres unavailable'); return null; }
}

test('submit disabled: /submit returns 403 even when kernel enabled', async (t) => {
  const pool = await pgOrSkip(t); if (!pool) return;
  try {
    await withEnv({ VNEXT_KERNEL_ENABLED: 'true', VNEXT_SUBMIT_ENABLED: undefined }, async () => {
      await pool.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq').catch(() => {});
      const app = express(); app.use('/vnext', createVnextKernelRouter(pool, { logger: silent }));
      const { server, port } = await listen(app);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/vnext/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workload: 'x402-purchase', idempotencyKey: 'k1' }) });
        assert.equal(r.status, 403);
        assert.match((await r.json()).error, /disabled/);
      } finally { server.close(); }
    });
  } finally { await pool.end(); }
});

test('submit enabled: buys an allowlisted x402 resource end-to-end through the kernel', async (t) => {
  const pool = await pgOrSkip(t); if (!pool) return;
  const { server: mSrv, port: mPort } = await listen(mockMerchant());
  try {
    const resourceUrl = `http://127.0.0.1:${mPort}/x402/data`;
    await withEnv({
      VNEXT_KERNEL_ENABLED: 'true', VNEXT_SUBMIT_ENABLED: 'true',
      VNEXT_X402_RESOURCES: JSON.stringify([{ url: resourceUrl, method: 'GET', supplierId: 'merchant-1' }]),
      VNEXT_FEE_BPS: '250',
    }, async () => {
      await pool.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq').catch(() => {});
      const app = express(); app.use('/vnext', createVnextKernelRouter(pool, { logger: silent }));
      const { server, port } = await listen(app);
      try {
        // health reflects the active submit path
        const h = await (await fetch(`http://127.0.0.1:${port}/vnext/health`)).json();
        assert.equal(h.submit, true);
        assert.equal(h.x402Resources, 1);

        const r = await fetch(`http://127.0.0.1:${port}/vnext/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workload: 'x402-purchase', idempotencyKey: 'buy-1', payer: '0xBuyer' }) });
        const b = await r.json();
        assert.equal(b.ok, true, `submit not CLOSED: ${JSON.stringify(b)}`);
        assert.equal(b.state, 'CLOSED');
        assert.equal(b.supplier, 'merchant-1');
        assert.equal(b.result.status, 200);        // merchant served goods after X-PAYMENT
        assert.equal(b.fee.amount, '25');           // 2.5% of 1000 = floor(1000*250/10000) = 25, USDC
        assert.equal(b.fee.currency, 'USDC');

        // idempotent: same key -> same txId, no re-run
        const r2 = await fetch(`http://127.0.0.1:${port}/vnext/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workload: 'x402-purchase', idempotencyKey: 'buy-1', payer: '0xBuyer' }) });
        const b2 = await r2.json();
        assert.equal(b2.txId, b.txId);
        assert.equal(b2.state, 'CLOSED');

        // journal shows the full lifecycle
        const jr = await (await fetch(`http://127.0.0.1:${port}/vnext/journal/${b.txId}`)).json();
        const phases = jr.phases.map((p) => p.phase);
        for (const p of ['SUBMIT', 'DISCOVER', 'QUOTE', 'ROUTE', 'SETTLE_IN', 'EXECUTE', 'FEE', 'SETTLE', 'CLOSED']) assert.ok(phases.includes(p), `missing ${p} in ${phases}`);
      } finally { server.close(); }
    });
  } finally { await pool.end(); mSrv.close(); }
});

test('SSRF-safe: a resource URL not on the allowlist is rejected (no fetch)', async (t) => {
  const pool = await pgOrSkip(t); if (!pool) return;
  const { server: mSrv, port: mPort } = await listen(mockMerchant());
  try {
    const allowed = `http://127.0.0.1:${mPort}/x402/data`;
    await withEnv({
      VNEXT_KERNEL_ENABLED: 'true', VNEXT_SUBMIT_ENABLED: 'true',
      VNEXT_X402_RESOURCES: JSON.stringify([{ url: allowed, method: 'GET', supplierId: 'merchant-1' }]),
    }, async () => {
      await pool.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq').catch(() => {});
      const app = express(); app.use('/vnext', createVnextKernelRouter(pool, { logger: silent }));
      const { server, port } = await listen(app);
      try {
        // Attempt to steer routing at an off-allowlist URL.
        const r = await fetch(`http://127.0.0.1:${port}/vnext/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workload: 'x402-purchase', idempotencyKey: 'ssrf-1', resource: 'http://169.254.169.254/latest/meta-data' }) });
        const b = await r.json();
        // No allowlisted resource matched -> no supply -> not CLOSED, nothing fetched.
        assert.equal(b.ok, false);
        assert.equal(b.state, 'REJECTED');
        assert.equal(b.reason, 'no_supply');
      } finally { server.close(); }
    });
  } finally { await pool.end(); mSrv.close(); }
});

test('outbound enabled without a signer: submit fails safe (no money, tx not CLOSED)', async (t) => {
  const pool = await pgOrSkip(t); if (!pool) return;
  const { server: mSrv, port: mPort } = await listen(mockMerchant());
  try {
    const resourceUrl = `http://127.0.0.1:${mPort}/x402/data`;
    await withEnv({
      VNEXT_KERNEL_ENABLED: 'true', VNEXT_SUBMIT_ENABLED: 'true',
      VNEXT_X402_RESOURCES: JSON.stringify([{ url: resourceUrl, method: 'GET', supplierId: 'merchant-1' }]),
      VNEXT_OUTBOUND_ENABLED: 'true', // kill switch ON, but the router wires no signer
      VNEXT_OUTBOUND_MAX_PER_TX: '100000',
    }, async () => {
      await pool.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq, vnext_outbound').catch(() => {});
      const app = express(); app.use('/vnext', createVnextKernelRouter(pool, { logger: silent }));
      const { server, port } = await listen(app);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/vnext/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workload: 'x402-purchase', idempotencyKey: 'os-1', payer: '0xB' }) });
        const b = await r.json();
        // No signer -> settleIn throws outbound_no_signer -> tx FAILED, resource never fetched.
        assert.equal(b.ok, false);
        assert.equal(b.state, 'FAILED');
        assert.match(String(b.reason || ''), /outbound_no_signer/);
        // Durable outbound ledger recorded no spend.
        const spent = await pool.query('SELECT COUNT(*)::int n FROM vnext_outbound');
        assert.equal(spent.rows[0].n, 0, 'money recorded despite fail-safe');
      } finally { server.close(); }
    });
  } finally { await pool.end(); mSrv.close(); }
});
