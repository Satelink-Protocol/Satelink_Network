import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTracker, validatePartner, partnerById, linkIdProblems, linkIdFingerprint, resolveBinanceLinkId, BINANCE_LINK_ID_SECRET } from '../src/trading_agent/partners/index.mjs';
import { linkPrefix } from '../src/trading_agent/brokers/binance/mapping.mjs';

// Stage 32 — partner validation: evidence-backed state changes only; Link ID from the secret store.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'docs/trading-agent/partners');
const tracker = JSON.parse(fs.readFileSync(path.join(DIR, 'partners.json'), 'utf8'));
const LINK = 'Fake1234Link';
const store = (v) => ({ get: async (name) => (name === BINANCE_LINK_ID_SECRET ? v : undefined) });
const errOf = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };

/** A fully evidenced, approved Binance entry (synthetic references). */
function approved() {
  const b = structuredClone(partnerById(tracker, 'binance'));
  b.evidence = [
    { id: 'EV-BIN-001', kind: 'portal_record', documentRef: 'portal submission 2026-10-01', providedBy: 'founder', receivedAt: '2026-10-01', summary: 'application' },
    { id: 'EV-BIN-002', kind: 'email', documentRef: 'email "Welcome to Binance Link" 2026-10-03', providedBy: 'founder', receivedAt: '2026-10-03', summary: 'acceptance' },
    { id: 'EV-BIN-003', kind: 'email', documentRef: 'email "Your Link ID" 2026-10-03', providedBy: 'founder', receivedAt: '2026-10-03', summary: 'Link ID + rebate API' },
  ];
  const set = (id, extra) => Object.assign(b.items.find((i) => i.id === id), { status: 'EVIDENCED', ...extra });
  set('application', { evidence: ['EV-BIN-001'] });
  set('written_confirmation', { evidence: ['EV-BIN-002'] });
  set('link_id', { evidence: ['EV-BIN-003'], linkIdFingerprint: linkIdFingerprint(LINK) });
  set('rebate_api', { evidence: ['EV-BIN-003'], answer: 'Exchange Link rebate records' });
  b.history = [{ from: 'UNVERIFIED', to: 'APPLIED', evidence: ['EV-BIN-001'] }, { from: 'APPLIED', to: 'PARTNER_APPROVED', evidence: ['EV-BIN-002'] }];
  b.state = 'PARTNER_APPROVED';
  return b;
}

describe('Stage 32 — partner validation', () => {
  it('the committed tracker is valid; every broker is UNVERIFIED with no evidence and no state change', () => {
    expect(validateTracker(tracker)).to.deep.equal([]);
    expect(tracker.partners.map((p) => [p.id, p.state, p.history.length, p.evidence.length])).to.deep.equal([['binance', 'UNVERIFIED', 0, 0], ['upstox', 'UNVERIFIED', 0, 0], ['alpaca', 'UNVERIFIED', 0, 0]]);
    expect(tracker.partners.flatMap((p) => p.items).every((i) => i.status === 'NO_EVIDENCE')).to.equal(true);
  });

  it('the pages agree with the tracker (state line, README row, one row per item)', () => {
    const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
    for (const p of tracker.partners) {
      const page = fs.readFileSync(path.join(DIR, `${p.id}.md`), 'utf8');
      expect(page).to.include(`**State: ${p.state}.**`);
      expect(readme).to.match(new RegExp(`\\| ${p.name} \\|[^\\n]*\\| \\*\\*${p.state}\\*\\* \\|`));
      const rows = page.split('\n').filter((l) => /^\| .* \| (NO_EVIDENCE|EVIDENCED) \|/.test(l));
      expect(rows.map((l) => l.split('|')[2].trim()), p.id).to.deep.equal(p.items.map((i) => i.status));
    }
  });

  it('no Link ID value in the partner docs or tracker', () => {
    for (const f of fs.readdirSync(DIR)) expect(fs.readFileSync(path.join(DIR, f), 'utf8'), f).to.not.match(/\bx-[A-Za-z0-9]{4,16}\b/);
  });

  it('Link ID prefix config validation agrees with the adapter prefix rule', () => {
    for (const ok of ['ABCD', 'abcd1234', 'A'.repeat(16), LINK]) {
      expect(linkIdProblems(ok), ok).to.deep.equal([]);
      expect(linkPrefix(ok)).to.equal(`x-${ok}`);
    }
    const bad = { ABC: /4–16/, ['A'.repeat(17)]: /4–16/, 'x-ABCD1234': /without the "x-" prefix/, 'X-ABCD1234': /without the "x-" prefix/, ' ABCD1234': /whitespace/, 'ABCD1234\n': /whitespace/, AB_CD: /4–16/, 'ABCDé1': /4–16/, '': /not set/ };
    for (const [v, re] of Object.entries(bad)) {
      expect(linkIdProblems(v).join(), JSON.stringify(v)).to.match(re);
      expect(() => linkPrefix(v), JSON.stringify(v)).to.throw();
    }
    expect(linkIdProblems(undefined)).to.deep.equal(['not set']);
    expect(linkIdProblems(12345678)).to.deep.equal(['must be a string']);
  });

  it('resolves the Link ID from the secret store; errors never echo the value', async () => {
    expect(await resolveBinanceLinkId({ secrets: store(LINK), environment: 'testnet' })).to.equal(LINK);
    expect((await errOf(resolveBinanceLinkId({ environment: 'testnet' }))).message).to.match(/secret store is required/);
    expect((await errOf(resolveBinanceLinkId({ secrets: store(undefined), environment: 'testnet' }))).message).to.match(/TRADING_BINANCE_LINK_ID: not set/);
    const e = await errOf(resolveBinanceLinkId({ secrets: store('x-Secret99'), environment: 'testnet' }));
    expect(e.message).to.match(/without the "x-" prefix/).and.not.include('Secret99');
    expect((await errOf(resolveBinanceLinkId({ secrets: store(LINK), environment: 'staging' }))).message).to.match(/unknown Binance environment/);
  });

  it('production needs PARTNER_APPROVED with a matching evidenced fingerprint', async () => {
    const denied = async (partner, re) => { const e = await errOf(resolveBinanceLinkId({ secrets: store(LINK), environment: 'production', partner })); expect(e.code).to.equal('PERMISSION_DENIED'); expect(e.message).to.match(re).and.not.include(LINK); };
    await denied(partnerById(tracker, 'binance'), /not PARTNER_APPROVED/);
    await denied(null, /not PARTNER_APPROVED/);
    const other = approved();
    other.items.find((i) => i.id === 'link_id').linkIdFingerprint = linkIdFingerprint('Other1234');
    await denied(other, /does not match/);
    expect(validatePartner(approved())).to.deep.equal([]);
    expect(await resolveBinanceLinkId({ secrets: store(LINK), environment: 'production', partner: approved() })).to.equal(LINK);
  });

  describe('state changes are refused without written founder evidence', () => {
    const cases = {
      'verbal evidence': [(b) => { b.evidence[1].kind = 'verbal'; }, /verbal evidence is not accepted/],
      'phone call evidence': [(b) => { b.evidence[1].kind = 'phone_call'; }, /verbal evidence is not accepted/],
      'unrecognised evidence kind': [(b) => { b.evidence[1].kind = 'screenshot'; }, /kind must be one of/],
      'not provided by the founder': [(b) => { b.evidence[1].providedBy = 'agent'; }, /providedBy must be "founder"/],
      'empty document reference': [(b) => { b.evidence[1].documentRef = ' '; }, /documentRef/],
      'state change citing nothing': [(b) => { b.history[1].evidence = []; }, /cites no evidence/],
      'unknown evidence id': [(b) => { b.history[1].evidence = ['EV-BIN-999']; }, /unknown evidence EV-BIN-999/],
      'approval on a portal record only': [(b) => { b.history[1].evidence = ['EV-BIN-001']; }, /needs a written confirmation/],
      'approval with the rebate answer missing': [(b) => { Object.assign(b.items.find((i) => i.id === 'rebate_api'), { status: 'NO_EVIDENCE', evidence: [], answer: null }); }, /item rebate_api must be EVIDENCED first/],
      'approval with no Link ID fingerprint': [(b) => { b.items.find((i) => i.id === 'link_id').linkIdFingerprint = null; }, /linkIdFingerprint \(16 hex\) required/],
      'skipping APPLIED': [(b) => { b.history = [{ from: 'UNVERIFIED', to: 'PARTNER_APPROVED', evidence: ['EV-BIN-002'] }]; }, /transition not allowed/],
      'state not backed by history': [(b) => { b.history = []; }, /must equal the history result "UNVERIFIED"/],
      'NO_EVIDENCE item carrying an answer': [(b) => { Object.assign(b.items.find((i) => i.id === 'rebate_api'), { status: 'NO_EVIDENCE', evidence: [] }); }, /NO_EVIDENCE items carry no evidence/],
      'EVIDENCED item citing nothing': [(b) => { b.items.find((i) => i.id === 'application').evidence = []; }, /item application: cites no evidence/],
    };
    for (const [name, [mutate, re]] of Object.entries(cases)) {
      it(name, () => {
        const b = approved();
        mutate(b);
        expect(validatePartner(b).join('\n')).to.match(re);
      });
    }

    it('a Link ID value or secret key in the tracker is refused', () => {
      const t = structuredClone(tracker);
      t.partners[0].items[2].linkId = 'Fake1234';
      expect(validateTracker(t).join()).to.match(/key "linkId" is not allowed/);
      const t2 = structuredClone(tracker);
      t2.partners[0].secret = 'x';
      expect(validateTracker(t2).join()).to.match(/key "secret" is not allowed/);
    });
  });
});
