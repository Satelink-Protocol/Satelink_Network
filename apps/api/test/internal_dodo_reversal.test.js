import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createDodoInternalRouter } from '../src/routes/internal_dodo.js';
import { setDodoSchemaReady } from '../src/db/dodo_schema_state.js';

// In-memory mock pool for POST /internal/dodo/reversal. Same substring-matching
// style as internal_dodo.test.js / credit_service.test.js. One shared state seen
// by both pool.query and pool.connect()'s client (mirrors a real pool/tx).
function makePool() {
  const state = {
    apiCredits: new Map(),      // api_key -> { credits_usdt, frozen_usdt, ... }
    apiDeposits: new Map(),     // tx_hash -> { api_key, credited_usdt, is_test_data }
    paymentSources: new Map(),  // tx_hash -> { credited_api_key, amount_usd, is_test_data }
    reversalLog: new Map(),     // event_id -> row
    revenueEvents: [],
    subscriptions: new Map(),   // api_key -> { status, provider }
  };

  function client() {
    return {
      async query(sql, params = []) {
        const s = sql.replace(/\s+/g, ' ').trim();

        if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };

        // ── idempotency log
        if (s.includes('SELECT 1 FROM dodo_refund_dispute_log WHERE event_id')) {
          return { rows: state.reversalLog.has(params[0]) ? [{ '?column?': 1 }] : [] };
        }
        if (s.includes('SELECT amount_usd, shortfall_usd FROM dodo_refund_dispute_log WHERE event_id')) {
          const row = state.reversalLog.get(params[0]);
          return { rows: row ? [{ amount_usd: row.amount_usd, shortfall_usd: row.shortfall_usd }] : [] };
        }
        if (s.includes('INSERT INTO dodo_refund_dispute_log')) {
          const [event_id, kind, event_type, dodo_ref, payment_id, api_key, amount_usd, shortfall_usd, is_test_data, created_at] = params;
          if (state.reversalLog.has(event_id)) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
          state.reversalLog.set(event_id, { event_id, kind, event_type, dodo_ref, payment_id, api_key, amount_usd, shortfall_usd, is_test_data, created_at });
          return { rowCount: 1, rows: [] };
        }

        // ── funding lookup
        if (s.includes('FROM api_deposits WHERE tx_hash')) {
          const d = state.apiDeposits.get(params[0]);
          return { rows: d ? [{ api_key: d.api_key, credited_usdt: d.credited_usdt, is_test_data: d.is_test_data }] : [] };
        }
        if (s.includes('FROM payment_sources WHERE tx_hash')) {
          const p = state.paymentSources.get(params[0]);
          return { rows: p ? [{ credited_api_key: p.credited_api_key, amount_usd: p.amount_usd, is_test_data: p.is_test_data }] : [] };
        }

        // ── api_credits reads/writes (order: most specific first)
        if (s.includes('SELECT credits_usdt FROM api_credits WHERE api_key') && s.includes('FOR UPDATE')) {
          const row = state.apiCredits.get(params[0]);
          return { rows: row ? [{ credits_usdt: row.credits_usdt }] : [] };
        }
        if (s.includes('frozen_usdt = frozen_usdt + $1')) {           // freeze
          const [amt, key] = params;
          const row = state.apiCredits.get(key);
          row.credits_usdt = +(row.credits_usdt - amt).toFixed(6);
          row.frozen_usdt = +(row.frozen_usdt + amt).toFixed(6);
          return { rowCount: 1, rows: [] };
        }
        if (s.includes('credits_usdt = credits_usdt + $1') && s.includes('frozen_usdt = GREATEST')) { // unfreeze
          const [amt, key] = params;
          const row = state.apiCredits.get(key);
          row.credits_usdt = +(row.credits_usdt + amt).toFixed(6);
          row.frozen_usdt = +(Math.max(0, row.frozen_usdt - amt)).toFixed(6);
          return { rowCount: 1, rows: [] };
        }
        if (s.includes('SET frozen_usdt = GREATEST')) {               // release (forfeit)
          const [amt, key] = params;
          const row = state.apiCredits.get(key);
          row.frozen_usdt = +(Math.max(0, row.frozen_usdt - amt)).toFixed(6);
          return { rowCount: 1, rows: [] };
        }
        if (s.includes('SET credits_usdt = credits_usdt - $1 WHERE api_key')) { // clawback
          const [amt, key] = params;
          const row = state.apiCredits.get(key);
          row.credits_usdt = +(row.credits_usdt - amt).toFixed(6);
          return { rowCount: 1, rows: [{ credits_usdt: row.credits_usdt }] };
        }
        if (s.includes('SET payment_hold = true')) {                  // payment hold
          const row = state.apiCredits.get(params[0]);
          if (row) row.payment_hold = true;
          return { rowCount: row ? 1 : 0, rows: [] };
        }

        // ── reversal revenue row
        if (s.includes('INSERT INTO revenue_events_v2')) {
          state.revenueEvents.push({
            op_type: 'refund_reversal', client_id: params[0], amount_usdt: params[1], request_id: params[2],
          });
          return { rowCount: 1, rows: [] };
        }

        // ── entitlement expiry
        if (s.includes("UPDATE subscriptions") && s.includes("status = 'cancelled'")) {
          const key = params[0];
          const sub = state.subscriptions.get(key);
          if (sub && sub.status !== 'cancelled') sub.status = 'cancelled';
          return { rowCount: sub ? 1 : 0, rows: [] };
        }

        throw new Error('unexpected SQL: ' + s);
      },
      release() {},
    };
  }

  return {
    state,
    async connect() { return client(); },
    async query(sql, params) { return client().query(sql, params); },
  };
}

function buildApp(pool) {
  const app = express();
  app.use('/internal/dodo', createDodoInternalRouter(pool));
  return app;
}

// Seed a Dodo payment that funded `credited` USD into `apiKey`.
function seedFunding(pool, { paymentId, apiKey, credited, isTest = false, balance }) {
  pool.state.apiDeposits.set(`dodo:${paymentId}`, { api_key: apiKey, credited_usdt: credited, is_test_data: isTest });
  pool.state.apiCredits.set(apiKey, {
    api_key: apiKey,
    credits_usdt: balance == null ? credited : balance,
    frozen_usdt: 0,
    payment_hold: false,
    status: 'active',
  });
}

const SECRET = 'test-secret-xyz';
const H = { 'x-dodo-internal-secret': SECRET };

describe('POST /internal/dodo/reversal — refunds & disputes', () => {
  let pool, app;
  const prevSecret = process.env.DODO_INTERNAL_SECRET;
  before(() => { process.env.DODO_INTERNAL_SECRET = SECRET; });
  after(() => { process.env.DODO_INTERNAL_SECRET = prevSecret; setDodoSchemaReady(true); });
  beforeEach(() => { pool = makePool(); app = buildApp(pool); setDodoSchemaReady(true); });

  const post = (body, headers = H) =>
    request(app).post('/internal/dodo/reversal').set(headers).send(body);

  it('full refund: claws back the whole credited balance, writes a reversal row, cancels the subscription', async () => {
    seedFunding(pool, { paymentId: 'pay_full', apiKey: 'sk_a', credited: 10 });
    pool.state.subscriptions.set('sk_a', { status: 'active', provider: 'dodo' });

    const res = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_1', paymentId: 'pay_full', isPartial: false });

    expect(res.status).to.equal(200);
    expect(res.body).to.include({ ok: true, matched: true, action: 'refund_full' });
    expect(pool.state.apiCredits.get('sk_a').credits_usdt).to.equal(0);
    const rev = pool.state.revenueEvents.find(r => r.request_id === 'dodo:refund:ref_1');
    expect(rev).to.exist;
    expect(rev.amount_usdt).to.equal(-10);            // negative reversal, original untouched
    expect(pool.state.subscriptions.get('sk_a').status).to.equal('cancelled');
    expect(pool.state.reversalLog.get('refund:ref_1').shortfall_usd).to.equal(0);
  });

  it('partial refund: claws back only the refunded portion', async () => {
    seedFunding(pool, { paymentId: 'pay_p', apiKey: 'sk_b', credited: 10 });
    // Refund 4.00 (400 minor units, USD) of a 10.00 payment.
    const res = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_2', paymentId: 'pay_p', isPartial: true, amountMinor: 400, currency: 'USD' });

    expect(res.status).to.equal(200);
    expect(res.body.action).to.equal('refund_partial');
    expect(pool.state.apiCredits.get('sk_b').credits_usdt).to.equal(6);
    const rev = pool.state.revenueEvents.find(r => r.request_id === 'dodo:refund:ref_2');
    expect(rev.amount_usdt).to.equal(-4);
  });

  it('refund after credits partly spent: floors balance at 0 and records the shortfall', async () => {
    // Credited 10, but only 3 left (7 already spent). Full refund → claw back 3, shortfall 7.
    seedFunding(pool, { paymentId: 'pay_s', apiKey: 'sk_c', credited: 10, balance: 3 });
    const res = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_3', paymentId: 'pay_s', isPartial: false });

    expect(res.status).to.equal(200);
    expect(res.body.clawedBack).to.equal(3);
    expect(res.body.shortfall).to.equal(7);
    expect(res.body.paymentHold).to.equal(true);
    expect(pool.state.apiCredits.get('sk_c').credits_usdt).to.equal(0); // floored, never negative
    expect(pool.state.apiCredits.get('sk_c').payment_hold).to.equal(true); // shortfall → held
    expect(pool.state.reversalLog.get('refund:ref_3').shortfall_usd).to.equal(7);
    const rev = pool.state.revenueEvents.find(r => r.request_id === 'dodo:refund:ref_3');
    expect(rev.amount_usdt).to.equal(-10); // full gross reversed regardless of shortfall
  });

  it('duplicate refund webhook: second delivery changes nothing', async () => {
    seedFunding(pool, { paymentId: 'pay_d', apiKey: 'sk_d', credited: 10 });
    const first = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_4', paymentId: 'pay_d', isPartial: false });
    expect(first.status).to.equal(200);
    expect(pool.state.apiCredits.get('sk_d').credits_usdt).to.equal(0);

    const second = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_4', paymentId: 'pay_d', isPartial: false });
    expect(second.status).to.equal(200);
    expect(second.body.duplicate).to.equal(true);
    expect(pool.state.apiCredits.get('sk_d').credits_usdt).to.equal(0); // unchanged
    expect(pool.state.revenueEvents.filter(r => r.request_id === 'dodo:refund:ref_4')).to.have.length(1);
  });

  it('dispute open → won: freezes then unfreezes, balance restored', async () => {
    seedFunding(pool, { paymentId: 'pay_dw', apiKey: 'sk_e', credited: 8 });

    const opened = await post({ eventType: 'dispute.opened', dodoRef: 'dsp_1', paymentId: 'pay_dw' });
    expect(opened.status).to.equal(200);
    expect(opened.body.action).to.equal('frozen');
    let acct = pool.state.apiCredits.get('sk_e');
    expect(acct.credits_usdt).to.equal(0);   // moved aside
    expect(acct.frozen_usdt).to.equal(8);    // held, not spendable

    const won = await post({ eventType: 'dispute.won', dodoRef: 'dsp_1', paymentId: 'pay_dw' });
    expect(won.status).to.equal(200);
    expect(won.body.action).to.equal('unfrozen');
    acct = pool.state.apiCredits.get('sk_e');
    expect(acct.credits_usdt).to.equal(8);   // restored
    expect(acct.frozen_usdt).to.equal(0);
    expect(pool.state.revenueEvents).to.have.length(0); // merchant kept the money — no reversal
  });

  it('dispute open → lost: freezes then claws back with a reversal row', async () => {
    seedFunding(pool, { paymentId: 'pay_dl', apiKey: 'sk_f', credited: 8 });
    pool.state.subscriptions.set('sk_f', { status: 'active', provider: 'dodo' });

    const opened = await post({ eventType: 'dispute.opened', dodoRef: 'dsp_2', paymentId: 'pay_dl' });
    expect(opened.status).to.equal(200);
    expect(pool.state.apiCredits.get('sk_f').frozen_usdt).to.equal(8);

    const lost = await post({ eventType: 'dispute.lost', dodoRef: 'dsp_2', paymentId: 'pay_dl' });
    expect(lost.status).to.equal(200);
    expect(lost.body.action).to.equal('dispute_clawback');
    const acct = pool.state.apiCredits.get('sk_f');
    expect(acct.frozen_usdt).to.equal(0);    // hold forfeited
    expect(acct.credits_usdt).to.equal(0);
    const rev = pool.state.revenueEvents.find(r => r.request_id === 'dodo:dispute:dsp_2');
    expect(rev.amount_usdt).to.equal(-8);
    expect(pool.state.subscriptions.get('sk_f').status).to.equal('cancelled');
  });

  it('dispute open → expired: credits stay FROZEN, no unfreeze, no clawback', async () => {
    seedFunding(pool, { paymentId: 'pay_dx', apiKey: 'sk_g', credited: 5 });

    const opened = await post({ eventType: 'dispute.opened', dodoRef: 'dsp_3', paymentId: 'pay_dx' });
    expect(opened.status).to.equal(200);
    expect(pool.state.apiCredits.get('sk_g').frozen_usdt).to.equal(5);
    expect(pool.state.apiCredits.get('sk_g').credits_usdt).to.equal(0);

    const expired = await post({ eventType: 'dispute.expired', dodoRef: 'dsp_3', paymentId: 'pay_dx' });
    expect(expired.status).to.equal(200);
    expect(expired.body.action).to.equal('expired_hold_frozen');
    const acct = pool.state.apiCredits.get('sk_g');
    expect(acct.frozen_usdt).to.equal(5);   // STILL frozen — no auto unfreeze
    expect(acct.credits_usdt).to.equal(0);  // and not returned to spendable
    expect(pool.state.revenueEvents).to.have.length(0); // no clawback/reversal
  });

  it('unknown payment id: no balance change, matched:false, 200 (no retry storm)', async () => {
    const res = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_x', paymentId: 'pay_missing', isPartial: false });
    expect(res.status).to.equal(200);
    expect(res.body.matched).to.equal(false);
    expect(pool.state.revenueEvents).to.have.length(0);
    expect(pool.state.reversalLog.has('refund:ref_x')).to.equal(true); // recorded for visibility
  });

  it('boot DDL failed (schema not ready) → webhook fails closed with 503', async () => {
    setDodoSchemaReady(false);
    try {
      seedFunding(pool, { paymentId: 'pay_nr', apiKey: 'sk_nr', credited: 5 });
      const res = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_nr', paymentId: 'pay_nr', isPartial: false });
      expect(res.status).to.equal(503);
      expect(res.body.error).to.equal('dodo_schema_not_ready');
      expect(pool.state.apiCredits.get('sk_nr').credits_usdt).to.equal(5); // untouched
    } finally {
      setDodoSchemaReady(true);
    }
  });

  it('secret missing → 503', async () => {
    const saved = process.env.DODO_INTERNAL_SECRET;
    delete process.env.DODO_INTERNAL_SECRET;
    try {
      const res = await post({ eventType: 'refund.succeeded', dodoRef: 'ref_z', paymentId: 'pay_z' }, {});
      expect(res.status).to.equal(503);
    } finally {
      process.env.DODO_INTERNAL_SECRET = saved;
    }
  });
});
