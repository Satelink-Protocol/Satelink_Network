import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify, Issue, assertOutsideRepo, evidenceRows } from '../../../scripts/trading/real-revenue-verify.mjs';

// Stage 34 — accounting reconciliation: journal txn ↔ statement line ↔ gateway / broker record.
// Synthetic data only. Only live, customer-funded, settled and three-way matched money counts.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(ROOT, 'scripts/trading/real-revenue-verify.mjs');

const entry = (accountId, direction, amount, currency = 'INR') => ({ accountId, direction, amount, currency, state: 'posted' });
const txn = (txnId, refType, refId, entries, currency = 'INR') => ({ txnId, kind: 'settlement', refType, refId, currency, state: 'posted', postedAt: '2026-11-02T10:00:00Z', entries });
/** Two Razorpay payments (₹499.00, fee ₹9.98 + 18% GST ₹1.80) settled in one batch, and one Binance rebate (12.34 USDT). */
function bundle() {
  return {
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
      { path: 'subscription', ref: 'bank:acct-ref/2026-11#L7', settlementId: 'setl_X1', direction: 'credit', amountMinor: '97444', currency: 'INR' },
      { path: 'rebate', ref: 'wallet:spot/2026-11#T99', settlementId: 'rb_T1', direction: 'credit', amountMinor: '1234', currency: 'USDT' },
    ],
  };
}
const codes = (r) => r.issues.map((i) => i.code);

describe('Stage 34 — real revenue three-way match', () => {
  it('matched, live, customer-funded, settled money: both paths REAL-REVENUE-VERIFIED with zero variance', () => {
    const r = verify(bundle());
    expect(r.issues).to.deep.equal([]);
    expect(r.verdicts).to.deep.equal({ subscription: 'REAL-REVENUE-VERIFIED', rebate: 'REAL-REVENUE-VERIFIED' });
    expect(r.items.map((i) => [i.journalTxnId, i.statementLineRef, i.sourceId, i.matched])).to.deep.equal([
      ['ltx_1', 'bank:acct-ref/2026-11#L7', 'pay_A1', true], ['ltx_2', 'bank:acct-ref/2026-11#L7', 'pay_A2', true], ['ltx_3', 'wallet:spot/2026-11#T99', 'rb_T1', true]]);
    expect(r.recognition.every((x) => /eligible: reclassify receivable → revenue .* not posted by this tool/.test(x.action))).to.equal(true);
    expect(evidenceRows(r)).to.include('| subscription | `ltx_1` | `bank:acct-ref/2026-11#L7` | `razorpay_payment:pay_A1` | MATCHED |').and.not.match(/49900|97444/);
  });

  it('a path is verified on its own: a clean subscription path is not held back by an empty rebate path', () => {
    const b = bundle();
    b.sources.pop(); b.journal.pop(); b.statementLines.pop();
    expect(verify(b).verdicts).to.deep.equal({ subscription: 'REAL-REVENUE-VERIFIED', rebate: 'NO_EVIDENCE' });
    expect(verify({ schema: 'real-revenue-input/1.0' }).verdicts).to.deep.equal({ subscription: 'NO_EVIDENCE', rebate: 'NO_EVIDENCE' });
  });

  const cases = {
    'test-mode payment': [(b) => { b.sources[0].mode = 'test'; }, Issue.SIMULATED_OR_TEST, 'subscription'],
    'founder-funded payment': [(b) => { b.sources[1].fundedBy = 'founder'; }, Issue.FOUNDER_FUNDED, 'subscription'],
    'funding not verified': [(b) => { delete b.sources[2].fundedBy; }, Issue.FUNDING_UNVERIFIED, 'rebate'],
    'expected, not settled': [(b) => { b.sources[2].status = 'pending'; }, Issue.NOT_SETTLED, 'rebate'],
    'no journal transaction': [(b) => { b.journal.splice(0, 1); }, Issue.UNMATCHED_JOURNAL, 'subscription'],
    'two journal transactions for one record': [(b) => { b.journal.push({ ...b.journal[0], txnId: 'ltx_dup' }); }, Issue.DUPLICATE, 'subscription'],
    'no statement line': [(b) => { b.statementLines.splice(0, 1); }, Issue.UNMATCHED_STATEMENT, 'subscription'],
    'statement short by one paisa': [(b) => { b.statementLines[0].amountMinor = '97443'; }, Issue.VARIANCE, 'subscription'],
    'journal revenue differs from gross': [(b) => { b.journal[2].entries = [entry('acct:wallet', 'debit', '1200', 'USDT'), entry('acct:receivable', 'credit', '1200', 'USDT')]; }, Issue.VARIANCE, 'rebate'],
    'fee not booked': [(b) => { b.journal[0].entries = [entry('acct:clearing', 'debit', '49900'), entry('acct:receivable', 'credit', '49900')]; }, Issue.FEE_NOT_BOOKED, 'subscription'],
    'unbalanced journal': [(b) => { b.journal[0].entries[0].amount = '48721'; }, Issue.JOURNAL_UNBALANCED, 'subscription'],
    'journal still pending': [(b) => { b.journal[1].state = 'pending'; }, Issue.JOURNAL_NOT_POSTED, 'subscription'],
    'simulated book account': [(b) => { b.journal[2].entries[1].accountId = 'sim:platform:rebate_revenue'; }, Issue.SIMULATED_OR_TEST, 'rebate'],
    'statement in another currency': [(b) => { b.statementLines[1].currency = 'USDC'; }, Issue.CURRENCY_MISMATCH, 'rebate'],
    'statement line with no record': [(b) => { b.statementLines.push({ path: 'rebate', ref: 'wallet:spot/2026-11#T100', settlementId: 'rb_T9', direction: 'credit', amountMinor: '500', currency: 'USDT' }); }, Issue.ORPHAN_STATEMENT_LINE, 'rebate'],
    'revenue journal with no record': [(b) => { b.journal.push(txn('ltx_9', 'razorpay_payment', 'pay_ZZ', [entry('acct:clearing', 'debit', '100'), entry('acct:revenue', 'credit', '100')])); }, Issue.ORPHAN_JOURNAL, 'subscription'],
    'statement line is a debit': [(b) => { b.statementLines[1].direction = 'debit'; }, Issue.INVALID, 'rebate'],
    'float amount': [(b) => { b.sources[2].grossMinor = '12.34'; }, Issue.INVALID, 'rebate'],
  };
  for (const [name, [mutate, code, stopped]] of Object.entries(cases)) {
    it(`STOP: ${name}`, () => {
      const b = bundle();
      mutate(b);
      const r = verify(b);
      expect(codes(r)).to.include(code);
      expect(r.stop).to.equal(true);
      expect(r.verdicts[stopped]).to.equal('STOP');
      expect(r.recognition.filter((x) => r.items.find((i) => i.sourceId === x.sourceId).path === stopped)).to.deep.equal([]);
      const other = stopped === 'subscription' ? 'rebate' : 'subscription';
      expect(r.verdicts[other], 'the other path is judged on its own').to.equal('REAL-REVENUE-VERIFIED');
    });
  }

  it('a variance on a batch un-matches every payment in it', () => {
    const b = bundle();
    b.statementLines[0].amountMinor = '97445';
    const r = verify(b);
    expect(r.items.filter((i) => i.path === 'subscription').map((i) => i.matched)).to.deep.equal([false, false]);
  });

  describe('CLI', () => {
    let dir;
    before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev34-')); });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });

    it('verified bundle → exit 0, report written outside git, evidence rows without amounts', () => {
      fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(bundle()));
      const r = run('--input', path.join(dir, 'in.json'), '--out', path.join(dir, 'report.json'), '--rows');
      expect(r.status, r.stderr).to.equal(0);
      expect(r.stdout).to.include('subscription: REAL-REVENUE-VERIFIED').and.include('rebate: REAL-REVENUE-VERIFIED').and.match(/report sha256:[0-9a-f]{64}/);
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')).stop).to.equal(false);
    });

    it('any issue → exit 1 (STOP)', () => {
      const b = bundle(); b.sources[0].fundedBy = 'founder';
      fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(b));
      const r = run('--input', path.join(dir, 'bad.json'));
      expect(r.status).to.equal(1);
      expect(r.stdout).to.include('STOP subscription FOUNDER_FUNDED pay_A1');
    });

    it('statements and reports inside the repository are refused (exit 2)', () => {
      const inside = path.join(ROOT, 'docs/trading-agent/evidence/first-real-revenue.md');
      expect(() => assertOutsideRepo(inside)).to.throw(/inside the repository/);
      expect(() => assertOutsideRepo(path.join(ROOT, 'not-yet-written.json'))).to.throw(/inside the repository/);
      expect(run('--input', inside).status).to.equal(2);
      fs.writeFileSync(path.join(dir, 'in2.json'), JSON.stringify(bundle()));
      const r = run('--input', path.join(dir, 'in2.json'), '--out', path.join(ROOT, 'report.json'));
      expect(r.status).to.equal(2);
      expect(fs.existsSync(path.join(ROOT, 'report.json'))).to.equal(false);
    });
  });

  it('the tool is read-only: no database, network, env or ledger writes', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    for (const re of [/process\.env/, /\bfetch\s*\(/, /node:(child_process|http|https|net)/, /from 'pg'|DATABASE_URL/, /\b(INSERT|UPDATE|DELETE)\s/]) expect(src, String(re)).to.not.match(re);
    expect(src.match(/writeFileSync\(/g)).to.have.length(1);
  });
});
