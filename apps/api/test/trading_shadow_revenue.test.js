import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ShadowRevenueEngine, Book, Stream, RevenueError, chartOfAccounts, accountType,
  expectedPosting, settlementPosting, refundPosting, costPosting, assertBalanced, evidenceFromVerification,
} from '../src/trading_agent/revenue/index.mjs';
import { verify } from '../../../scripts/trading/real-revenue-verify.mjs';

// Stage 20 (option 2) — shadow revenue engine. Synthetic data only; nothing touches the ledger.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ON = { TRADING_FLAG_REVENUE_ENGINE: 'true' };
const engine = () => new ShadowRevenueEngine({ env: ON });
const live = (o) => ({ mode: 'live', simulated: false, at: '2026-11-02T10:00:00Z', ...o });
const sim = (o) => ({ mode: 'test', simulated: true, at: '2026-11-02T10:00:00Z', ...o });
const sub = (id, amountMinor = '49900', cur = 'INR') => live({ type: 'subscription_payment', id, amountMinor, currency: cur });
const ev = (eventId, o = {}) => ({
  eventType: 'subscription_payment', eventId, evidenceId: `ltx|stmt|${eventId}`, matched: true, mode: 'live', simulated: false,
  fundedBy: 'customer', settled: true, grossMinor: '49900', feeMinor: '1178', currency: 'INR', statementRef: 'stmt-1', ...o,
});
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

describe('trading: Stage 20 shadow revenue engine', () => {
  describe('flag + chart of accounts', () => {
    it('is OFF by default: constructing without TRADING_FLAG_REVENUE_ENGINE=true throws DISABLED', () => {
      expect(code(() => new ShadowRevenueEngine({ env: {} }))).to.equal('DISABLED');
      expect(code(() => new ShadowRevenueEngine({ env: { TRADING_FLAG_REVENUE_ENGINE: '1' } }))).to.equal('DISABLED');
      expect(() => engine()).to.not.throw();
    });

    it('sim and real charts are disjoint, fully namespaced, and cover every stream', () => {
      const s = chartOfAccounts(Book.SIM).map((a) => a.id);
      const r = chartOfAccounts(Book.REAL).map((a) => a.id);
      expect(s.every((id) => id.startsWith('sim:'))).to.equal(true);
      expect(r.every((id) => id.startsWith('real:'))).to.equal(true);
      expect(s.filter((id) => r.includes(id))).to.deep.equal([]);
      for (const st of Object.values(Stream)) for (const t of ['receivable', 'revenue_expected', 'revenue', 'contra:refunds']) {
        expect(r).to.include(`real:${t}:${st}`);
      }
      expect(accountType('real:revenue:subscription')).to.equal('revenue');
      expect(accountType('sim:clearing:gateway')).to.equal('asset');
    });
  });

  describe('posting rules (pure)', () => {
    it('every rule balances per currency and is deterministic', () => {
      const a = expectedPosting(Book.REAL, sub('p1'));
      expect(expectedPosting(Book.REAL, sub('p1'))).to.deep.equal(a);
      for (const p of [a,
        settlementPosting(Book.REAL, Stream.SUBSCRIPTION, { grossMinor: '49900', feeMinor: '1178', currency: 'INR' }),
        refundPosting(Book.REAL, Stream.SUBSCRIPTION, { amountMinor: '100', currency: 'INR', settled: true }),
        refundPosting(Book.REAL, Stream.SUBSCRIPTION, { amountMinor: '100', currency: 'INR', settled: false }),
        costPosting(Book.SIM, sim({ type: 'model_cost', id: 'm1', amountMinor: '42', currency: 'USD' }))]) {
        expect(() => assertBalanced(p)).to.not.throw();
        expect(Object.isFrozen(p)).to.equal(true);
      }
    });

    it('rejects floats, negatives, zero and lower-case currencies', () => {
      expect(code(() => expectedPosting(Book.REAL, { ...sub('x'), amountMinor: 499.0 }))).to.equal('INVALID');
      expect(code(() => expectedPosting(Book.REAL, { ...sub('x'), amountMinor: '-1' }))).to.equal('INVALID');
      expect(code(() => expectedPosting(Book.REAL, { ...sub('x'), amountMinor: '0' }))).to.equal('INVALID');
      expect(code(() => expectedPosting(Book.REAL, { ...sub('x'), currency: 'inr' }))).to.equal('INVALID');
      expect(code(() => settlementPosting(Book.REAL, Stream.SUBSCRIPTION, { grossMinor: '10', feeMinor: '11', currency: 'INR' }))).to.equal('INVALID');
    });

    it('assertBalanced catches an unbalanced posting', () => {
      expect(code(() => assertBalanced([{ account: 'real:clearing:gateway', debitMinor: 1n, creditMinor: 0n, currency: 'INR' }]))).to.equal('UNBALANCED');
    });
  });

  describe('books', () => {
    it('the real book refuses simulated / test events; the sim book refuses live ones', () => {
      const e = engine();
      expect(code(() => e.record(sim({ type: 'subscription_payment', id: 's1', amountMinor: '100', currency: 'INR' }), { book: Book.REAL }))).to.equal('SIMULATED_IN_REAL');
      expect(code(() => e.record({ ...sub('s2'), simulated: true }, { book: Book.REAL }))).to.equal('SIMULATED_IN_REAL');
      expect(code(() => e.record(sub('s3'), { book: Book.SIM }))).to.equal('REAL_IN_SIM');
      expect(e.record(sim({ type: 'subscription_payment', id: 's4', amountMinor: '100', currency: 'INR' }), { book: Book.SIM }).posted).to.equal(true);
      expect(e.entries(Book.REAL)).to.have.length(0);
    });

    it('records are idempotent by (type, id) and append-only', () => {
      const e = engine();
      expect(e.record(sub('p1'), { book: Book.REAL })).to.deep.equal({ posted: true, kind: 'expected' });
      expect(e.record(sub('p1'), { book: Book.REAL })).to.deep.equal({ posted: false, duplicate: true });
      const entries = e.entries(Book.REAL);
      expect(entries).to.have.length(2);
      expect(Object.isFrozen(entries[0])).to.equal(true);
      entries.pop();
      expect(e.entries(Book.REAL)).to.have.length(2);
    });
  });

  describe('expected → actual only on matched evidence', () => {
    it('an expected event credits revenue_expected, never revenue', () => {
      const e = engine();
      e.record(sub('p1'), { book: Book.REAL });
      const tb = e.trialBalance(Book.REAL);
      expect(tb['real:revenue_expected:subscription'].INR).to.equal(-49900n);
      expect(tb['real:receivable:subscription'].INR).to.equal(49900n);
      expect(tb['real:revenue:subscription']).to.equal(undefined);
    });

    it('matched evidence moves gross to actual revenue and books cash net of fees', () => {
      const e = engine();
      e.record(sub('p1'), { book: Book.REAL });
      expect(e.settle(ev('p1'), { book: Book.REAL })).to.deep.equal({ posted: true, residualMinor: 0n });
      const tb = e.trialBalance(Book.REAL);
      expect(tb['real:revenue:subscription'].INR).to.equal(-49900n);
      expect(tb['real:revenue_expected:subscription'].INR).to.equal(0n);
      expect(tb['real:receivable:subscription'].INR).to.equal(0n);
      expect(tb['real:clearing:gateway'].INR).to.equal(48722n);
      expect(tb['real:expense:gateway_fees'].INR).to.equal(1178n);
      expect(e.balanced(Book.REAL)).to.equal(true);
      expect(e.settle(ev('p1'), { book: Book.REAL })).to.deep.equal({ posted: false, duplicate: true });
    });

    const refusals = [
      ['NOT_MATCHED', { matched: false }],
      ['NOT_MATCHED', { statementRef: '' }],
      ['NOT_SETTLED', { settled: false }],
      ['FOUNDER_FUNDED', { fundedBy: 'founder' }],
      ['FOUNDER_FUNDED', { fundedBy: undefined }],
      ['SIMULATED_IN_REAL', { simulated: true }],
      ['SIMULATED_IN_REAL', { mode: 'test' }],
      ['CURRENCY_MISMATCH', { currency: 'USD' }],
      ['OVER_RECEIPT', { grossMinor: '49901' }],
      ['UNKNOWN_EVENT', { eventId: 'nope' }],
    ];
    for (const [c, patch] of refusals) {
      it(`refuses evidence → ${c} (${JSON.stringify(patch)}), posting nothing`, () => {
        const e = engine();
        e.record(sub('p1'), { book: Book.REAL });
        const before = e.entries(Book.REAL).length;
        expect(code(() => e.settle(ev('p1', patch), { book: Book.REAL }))).to.equal(c);
        expect(e.entries(Book.REAL).length).to.equal(before);
        expect(e.trialBalance(Book.REAL)['real:revenue:subscription']).to.equal(undefined);
      });
    }

    it('partial evidence leaves the residual open and visible in the variance report', () => {
      const e = engine();
      e.record(sub('p1'), { book: Book.REAL });
      e.record(sub('p2', '1000'), { book: Book.REAL });
      expect(e.settle(ev('p1', { grossMinor: '40000', feeMinor: '0' }), { book: Book.REAL }).residualMinor).to.equal(9900n);
      const r = e.varianceReport(Book.REAL);
      expect(r.balanced).to.equal(true);
      expect(r.streams).to.deep.equal([{ stream: 'subscription', currency: 'INR', expectedMinor: '50900', actualMinor: '40000', refundedMinor: '0', varianceMinor: '10900' }]);
      expect(r.open.map((o) => [o.item, o.status, o.residualMinor])).to.deep.equal([
        ['subscription_payment:p1', 'partial', '9900'], ['subscription_payment:p2', 'unmatched', '1000'],
      ]);
      expect(JSON.parse(JSON.stringify(r)).schema).to.equal('shadow-revenue-variance/1.0');
    });
  });

  describe('refunds', () => {
    it('refund of an unsettled event reverses the accrual; of a settled one books contra-revenue', () => {
      const e = engine();
      e.record(sub('p1', '1000'), { book: Book.REAL });
      e.settle(ev('p1', { grossMinor: '600', feeMinor: '0' }), { book: Book.REAL });
      const r = e.refund({ eventType: 'subscription_payment', eventId: 'p1', refundId: 'rf1', amountMinor: '700', mode: 'live', simulated: false }, { book: Book.REAL });
      expect(r).to.deep.equal({ posted: true, fromOpenMinor: 400n, fromSettledMinor: 300n });
      const tb = e.trialBalance(Book.REAL);
      expect(tb['real:contra:refunds:subscription'].INR).to.equal(300n);
      expect(tb['real:receivable:subscription'].INR).to.equal(0n);
      expect(e.balanced(Book.REAL)).to.equal(true);
      expect(e.varianceReport(Book.REAL).open).to.deep.equal([]);
      expect(code(() => e.refund({ eventType: 'subscription_payment', eventId: 'p1', refundId: 'rf2', amountMinor: '301', mode: 'live', simulated: false }, { book: Book.REAL }))).to.equal('OVER_REFUND');
    });
  });

  it('stays balanced over a long random sequence (both books)', () => {
    const e = engine();
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const id = `r${rnd(60)}`; const amt = String(1 + rnd(5000));
      const book = rnd(2) ? Book.REAL : Book.SIM;
      const base = book === Book.REAL ? live({}) : sim({});
      try {
        switch (rnd(4)) {
          case 0: e.record({ ...base, type: 'subscription_payment', id, amountMinor: amt, currency: 'INR' }, { book }); break;
          case 1: e.settle({ ...ev(id, { grossMinor: String(1 + rnd(3000)), feeMinor: '0' }), ...base, evidenceId: `e${i}` }, { book }); break;
          case 2: e.refund({ eventType: 'subscription_payment', eventId: id, refundId: `f${i}`, amountMinor: String(1 + rnd(2000)), ...base }, { book }); break;
          default: e.record({ ...base, type: 'model_cost', id: `m${i}`, amountMinor: amt, currency: 'USD' }, { book });
        }
      } catch (err) { expect(err).to.be.instanceOf(RevenueError); }
    }
    expect(e.balanced(Book.REAL)).to.equal(true);
    expect(e.balanced(Book.SIM)).to.equal(true);
  });

  describe('integration with the Stage 34 three-way matcher', () => {
    const entry = (accountId, direction, amount, currency = 'INR') => ({ accountId, direction, amount, currency, state: 'posted' });
    const txn = (txnId, refType, refId, entries, currency = 'INR') => ({ txnId, kind: 'settlement', refType, refId, currency, state: 'posted', postedAt: '2026-11-02T10:00:00Z', entries });
    const bundle = () => ({
      schema: 'real-revenue-input/1.0',
      accounts: { 'acct:receivable': 'receivable', 'acct:revenue': 'revenue', 'acct:clearing': 'cash', 'acct:fees': 'fee_expense', 'acct:wallet': 'cash' },
      sources: [
        { type: 'razorpay_payment', id: 'pay_A1', mode: 'live', status: 'settled', fundedBy: 'customer', grossMinor: '49900', feeMinor: '998', taxMinor: '180', currency: 'INR', settlementId: 'setl_X1' },
        { type: 'razorpay_payment', id: 'pay_A2', mode: 'live', status: 'settled', fundedBy: 'customer', grossMinor: '49900', feeMinor: '998', taxMinor: '180', currency: 'INR', settlementId: 'setl_X1' },
        { type: 'binance_rebate', id: 'rb_T1', mode: 'live', status: 'settled', fundedBy: 'customer', grossMinor: '1234', currency: 'USDT', settlementId: 'rb_T1' },
      ],
      journal: [
        txn('ltx_1', 'razorpay_payment', 'pay_A1', [entry('acct:clearing', 'debit', '48722'), entry('acct:fees', 'debit', '1178'), entry('acct:receivable', 'credit', '49900')]),
        txn('ltx_2', 'razorpay_payment', 'pay_A2', [entry('acct:clearing', 'debit', '48722'), entry('acct:fees', 'debit', '1178'), entry('acct:receivable', 'credit', '49900')]),
        txn('ltx_3', 'binance_rebate', 'rb_T1', [entry('acct:wallet', 'debit', '1234', 'USDT'), entry('acct:receivable', 'credit', '1234', 'USDT')], 'USDT'),
      ],
      statementLines: [
        { ref: 'stmt-hdfc-1', path: 'subscription', settlementId: 'setl_X1', direction: 'credit', amountMinor: '97444', currency: 'INR' },
        { ref: 'wallet-1', path: 'rebate', settlementId: 'rb_T1', direction: 'credit', amountMinor: '1234', currency: 'USDT' },
      ],
    });

    it('verified items settle with zero variance; the engine agrees with the matcher', () => {
      const b = bundle();
      const res = verify(b);
      expect(res.stop).to.equal(false);
      const { evidence, skipped } = evidenceFromVerification(b, res);
      expect(skipped).to.deep.equal([]);
      expect(evidence).to.have.length(3);
      const e = engine();
      e.record(sub('pay_A1'), { book: Book.REAL });
      e.record(sub('pay_A2'), { book: Book.REAL });
      e.record(live({ type: 'broker_rebate', id: 'rb_T1', amountMinor: '1234', currency: 'USDT' }), { book: Book.REAL });
      for (const x of evidence) expect(e.settle(x, { book: Book.REAL }).posted).to.equal(true);
      const r = e.varianceReport(Book.REAL);
      expect(r.open).to.deep.equal([]);
      expect(r.streams.map((s) => [s.stream, s.currency, s.actualMinor, s.varianceMinor])).to.deep.equal([
        ['rebate', 'USDT', '1234', '0'], ['subscription', 'INR', '99800', '0'],
      ]);
      expect(e.trialBalance(Book.REAL)['real:clearing:gateway'].INR).to.equal(97444n); // = the bank statement line
    });

    it('a path the matcher STOPs produces no evidence, so expected stays unrecognised', () => {
      const b = bundle();
      b.sources[2].fundedBy = 'founder';
      const res = verify(b);
      const { evidence, skipped } = evidenceFromVerification(b, res);
      expect(evidence.map((x) => x.eventId)).to.deep.equal(['pay_A1', 'pay_A2']);
      expect(skipped.map((s) => s.sourceId)).to.deep.equal(['rb_T1']);
    });
  });

  describe('isolation (no ledger writes, no schema change, not mounted)', () => {
    const dir = path.join(ROOT, 'apps/api/src/trading_agent/revenue');
    const src = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    it('imports nothing from the Financial-OS ledger and contains no SQL', () => {
      expect(src).to.not.match(/financial-domain|services\/financial|workers\/reconciler|from ['"]pg['"]/);
      expect(src).to.not.match(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i);
    });
    it('adds no migration and is not mounted by the API', () => {
      const migs = fs.readdirSync(path.join(ROOT, 'database/migrations')).join('\n');
      expect(migs).to.not.match(/revenue_engine|shadow_revenue/);
      for (const f of ['apps/api/app_factory.mjs', 'apps/api/server.js']) expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).to.not.match(/trading_agent\/revenue/);
    });
  });
});
