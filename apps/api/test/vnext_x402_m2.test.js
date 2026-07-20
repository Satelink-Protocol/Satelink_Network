// M2 integration test — first REAL routing adapter (x402 machine payment)
// through the UNCHANGED M1 kernel. Only the HTTP transport is mocked; all x402
// parsing, payment construction, quoting, execution, settlement, journaling,
// idempotency and replay are real. Run: `node --test test/vnext_x402_m2.test.js`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RoutingKernel } from '../src/vnext/kernel/kernel.js';
import { Journal } from '../src/vnext/kernel/journal.js';
import { IdempotencyStore, deriveTxId } from '../src/vnext/kernel/idempotency.js';
import { Registry } from '../src/vnext/kernel/registry.js';
import { FixedFeeAdapter } from '../src/vnext/kernel/fixed_fee.js';
import { TxState } from '../src/vnext/kernel/transaction.js';

import { X402Context } from '../src/vnext/adapters/x402/x402_context.js';
import { X402PurchaseAdapter } from '../src/vnext/adapters/x402/x402_purchase_adapter.js';
import { X402SettlementAdapter } from '../src/vnext/adapters/x402/x402_settlement_adapter.js';

// Mock ONLY the network transport. No X-PAYMENT header -> real-shaped 402
// challenge; with X-PAYMENT -> 200 goods. Everything else is real.
function makeMockFetch() {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    const paid = !!(opts.headers && opts.headers['X-PAYMENT']);
    if (!paid) {
      return {
        status: 402,
        async json() {
          return {
            x402Version: 1,
            accepts: {
              scheme: 'exact',
              network: 'eip155:8453',
              payTo: '0x966E1Ae22996545015b1414B35234b10719d7Ad4',
              maxAmountRequired: '1000',
              resource: url,
              mimeType: 'application/json',
            },
          };
        },
      };
    }
    return { status: 200, async json() { return { ok: true, data: 'premium-payload' }; } };
  };
  return { fetchFn, calls };
}

function newHarness() {
  const { fetchFn, calls } = makeMockFetch();
  const ctx = new X402Context();
  const registry = new Registry();
  registry.register(new X402PurchaseAdapter({
    resources: [{ url: 'https://merchant.example/x402/data', method: 'GET', supplierId: 'merchant-1' }],
    ctx,
    fetchFn,
  }));
  const kernel = new RoutingKernel({
    registry,
    settlement: new X402SettlementAdapter({ ctx }),
    fee: new FixedFeeAdapter(),
    journal: new Journal(),
    idempotency: new IdempotencyStore(),
  });
  return { kernel, calls };
}

test('M2: real x402 purchase runs full PRE lifecycle to CLOSED', async () => {
  const { kernel, calls } = newHarness();
  const txId = deriveTxId('m2-buy-1');
  const tx = await kernel.execute({ workload: 'x402-purchase', payer: '0xBuyer' }, { txId });

  assert.equal(tx.state, TxState.CLOSED);
  // Real quote parsed from the 402 challenge.
  assert.equal(tx.quote.cost, 1000);
  assert.equal(tx.quote.network, 'eip155:8453');
  // Real execution returned the paid goods.
  assert.equal(tx.result.status, 200);
  assert.deepEqual(tx.result.body, { ok: true, data: 'premium-payload' });
  assert.ok(String(tx.result.paidWith).startsWith('x402_'));

  // PRE mode journaled SETTLE_IN before EXECUTE, then SETTLE, then CLOSED.
  const phases = kernel.journal.read(txId).map((e) => e.phase);
  for (const p of ['DISCOVER', 'QUOTE', 'ROUTE', 'SETTLE_IN', 'EXECUTE', 'SETTLE', 'CLOSED']) {
    assert.ok(phases.includes(p), `journal missing phase ${p}`);
  }

  // A real X-PAYMENT header was actually sent on the execute request.
  assert.ok(calls.some((c) => c.headers && c.headers['X-PAYMENT']), 'no X-PAYMENT header sent');
});

test('M2: journal hash chain intact + replay reconstructs to CLOSED', async () => {
  const { kernel } = newHarness();
  const txId = deriveTxId('m2-chain');
  await kernel.execute({ workload: 'x402-purchase', payer: '0xB' }, { txId });
  assert.equal(kernel.journal.verifyChain(), true);
  assert.equal(kernel.reconstruct(txId).terminal, 'CLOSED');
});

test('M2: idempotent — replaying same txId does not re-run phases or re-pay', async () => {
  const { kernel, calls } = newHarness();
  const txId = deriveTxId('m2-idem');
  const req = { workload: 'x402-purchase', payer: '0xB' };
  await kernel.execute(req, { txId });
  const journalLen = kernel.journal.all().length;
  const callCount = calls.length;

  const replay = await kernel.execute(req, { txId });
  assert.equal(replay.state, TxState.CLOSED);
  assert.equal(kernel.journal.all().length, journalLen); // no new journal entries
  assert.equal(calls.length, callCount); // no new network calls (exactly-once)
});
