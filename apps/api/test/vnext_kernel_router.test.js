// vNext kernel HTTP router — mount behavior in the app.
// Disabled path is DB-free and always runs. Enabled path uses the local
// vnext_m6_test DB (never prod DATABASE_URL) and skips if unavailable.
// Run: `node --test test/vnext_kernel_router.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';

import { createVnextKernelRouter } from '../src/vnext/http/kernel_router.js';

const LOCAL_DSN = 'postgresql:///vnext_m6_test?host=/tmp';
const silent = { log() {}, error() {} };

function serve(router) {
  const app = express();
  app.use('/vnext', router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('disabled (default): every vnext route returns 503, no pool access', async () => {
  const prev = process.env.VNEXT_KERNEL_ENABLED;
  delete process.env.VNEXT_KERNEL_ENABLED;
  // A pool that throws if touched — proves the disabled router never hits the DB.
  const explodingPool = { query() { throw new Error('DB must not be touched when disabled'); }, connect() { throw new Error('no connect when disabled'); } };
  const { server, port } = await serve(createVnextKernelRouter(explodingPool, { logger: silent }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/vnext/health`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /disabled/);
  } finally {
    server.close();
    if (prev === undefined) delete process.env.VNEXT_KERNEL_ENABLED; else process.env.VNEXT_KERNEL_ENABLED = prev;
  }
});

test('enabled: /health boots the durable kernel and reports state (real PG)', async (t) => {
  let pool;
  try { pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 3 }); await pool.query('SELECT 1'); }
  catch { return t.skip('local postgres unavailable'); }

  const prev = process.env.VNEXT_KERNEL_ENABLED;
  process.env.VNEXT_KERNEL_ENABLED = 'true';
  try {
    await pool.query('TRUNCATE vnext_journal, vnext_idempotency, vnext_suppliers, vnext_dlq').catch(() => {});
    const { server, port } = await serve(createVnextKernelRouter(pool, { logger: silent }));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/vnext/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.enabled, true);
      assert.equal(body.chainValid, true);
      assert.equal(typeof body.journalEvents, 'number');

      const jr = await fetch(`http://127.0.0.1:${port}/vnext/journal/nope`);
      const jb = await jr.json();
      assert.equal(jb.ok, true);
      assert.deepEqual(jb.phases, []);
    } finally { server.close(); }
  } finally {
    if (prev === undefined) delete process.env.VNEXT_KERNEL_ENABLED; else process.env.VNEXT_KERNEL_ENABLED = prev;
    await pool.end();
  }
});
