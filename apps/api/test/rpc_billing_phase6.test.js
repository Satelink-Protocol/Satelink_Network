import { expect } from 'chai';
import { recordRpcRevenue } from '../src/workloads/rpc_gateway/rpc_billing.js';

// Phase 6: a revenue event is created ONLY when a real deduction occurred
// (amountUsdt > 0). Free/anonymous/exhausted traffic (amountUsdt <= 0 / missing)
// must produce NO insert.
function mockPool() {
  const inserts = [];
  return { inserts, query: async (sql, params) => { if (/INSERT INTO revenue_events_v2/.test(sql)) inserts.push(params); return { rows: [], rowCount: 1 }; } };
}

describe('Phase 6 — recordRpcRevenue gating', () => {
  it('skips when amountUsdt is 0 (free tier)', async () => {
    const pool = mockPool();
    const r = await recordRpcRevenue({ pool, chain: 'polygon', method: 'eth_blockNumber', apiKey: 'sk_free_x', requestId: 'r1', amountUsdt: 0 });
    expect(r).to.deep.equal({ recorded: false, reason: 'no_deduction' });
    expect(pool.inserts.length).to.equal(0);
  });

  it('skips when amountUsdt is missing (anonymous / legacy caller)', async () => {
    const pool = mockPool();
    const r = await recordRpcRevenue({ pool, chain: 'polygon', method: 'eth_call', apiKey: undefined, requestId: 'r2' });
    expect(r.recorded).to.equal(false);
    expect(pool.inserts.length).to.equal(0);
  });

  it('skips negative / NaN amounts', async () => {
    const pool = mockPool();
    await recordRpcRevenue({ pool, requestId: 'r3', amountUsdt: -0.01 });
    await recordRpcRevenue({ pool, requestId: 'r4', amountUsdt: 'abc' });
    expect(pool.inserts.length).to.equal(0);
  });

  it('records the ACTUAL deducted amount when amountUsdt > 0 (paid)', async () => {
    const pool = mockPool();
    await recordRpcRevenue({ pool, chain: 'polygon', method: 'eth_call', apiKey: 'sk_pro_y', requestId: 'r5', amountUsdt: 0.00003 });
    expect(pool.inserts.length).to.equal(1);
    // params: [op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source]
    expect(pool.inserts[0][2]).to.equal(0.00003);   // amount == deducted, not list price
    expect(pool.inserts[0][1]).to.equal('sk_pro_y'); // client_id
  });
});
