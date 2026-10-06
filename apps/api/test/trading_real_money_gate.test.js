import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGate, renderGateDoc, evaluateApprovals, evaluateRestrictions, LIVE_SMALL_CEILINGS } from '../../../scripts/trading/real-money-gate.mjs';

// Stage 31 — REAL MONEY GATE 1 tooling. The gate must be CLOSED whenever any item is missing, and the tool must never enable anything.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SCRIPT = path.join(ROOT, 'scripts/trading/real-money-gate.mjs');
const NOW = Date.parse('2026-10-06T12:00:00Z');
const ITEMS = ['G1-01', 'G1-02', 'G1-03', 'G1-04', 'G1-05', 'G1-06', 'G1-07', 'G1-08', 'G1-09'];
const IP = '203.0.113.10';

const write = (root, rel, data) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const ev = (rel) => `docs/trading-agent/gates/evidence/${rel}`;

/** A synthetic repo where every item is evidenced (no approvals yet). */
function completeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate1-'));
  write(root, 'docs/trading-agent/BLOCKERS.md', fs.readFileSync(path.join(ROOT, 'docs/trading-agent/BLOCKERS.md'), 'utf8').replace(/^\| (B-\d{2}) \| [A-Z]+ \|/gm, '| $1 | RESOLVED |'));
  for (const f of ['apps/api/src/trading_agent/flags.mjs', 'apps/web/src/lib/trading-agent/status.ts']) write(root, f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
  write(root, ev('gate-6.json'), { runs: Array.from({ length: 5 }, (_, i) => ({ url: `https://github.com/o/r/actions/runs/${100 + i}`, conclusion: 'success', testnet: 'exercised' })) });
  write(root, ev('gate-7.json'), Object.fromEntries(['kmsEnvelopeEncryption', 'dbRoleSeparation', 'staticEgressIp', 'ciSecretScan', 'ciLicenceScan', 'dailyKeyRecheck', 'adminStepUp', 'prodSecretsRotated'].map((k) => [k, { done: true, evidence: 'PR link' }])));
  write(root, ev('broker-keys/binance-a.json'), { keyFingerprint: '0123456789abcdef', capturedAt: '2026-10-06T08:00:00Z', whitelistedIps: [IP], restrictions: { enableWithdrawals: false, enableInternalTransfer: false, permitsUniversalTransfer: false, ipRestrict: true, enableSpotAndMarginTrading: true, enableReading: true } });
  write(root, ev('egress.json'), { ip: IP, region: 'ap-northeast-1' });
  write(root, ev('suites.json'), { commit: 'abc1234', recordedAt: '2026-10-05T00:00:00Z', tradingUnit: { passes: 10, failures: 0 }, tradingIntegration: { passes: 5, failures: 0 }, baseline: { passes: 700, failures: 0 } });
  write(root, ev('legal.json'), Object.fromEntries(['scopeDecision', 'brokerTermsReview', 'riskDisclosure', 'tradingAgentTerms', 'gstInvoiceFormat'].map((k) => [k, { signedOffBy: 'counsel', date: '2026-10-01' }])));
  write(root, 'docs/trading-agent/gates/live-small-allowlist.json', { accounts: [{ principalId: 'prn_alice', brokerAccountId: 'bka_alice01', instruments: ['BTCUSDT'], maxOrderNotionalMinor: '5000', maxDailyNotionalMinor: '20000', expiresAt: '2026-10-20T00:00:00Z' }] });
  return root;
}
const approve = (root, hash, list) => write(root, ev('approvals.json'), { approvals: list.map(([githubLogin, role]) => ({ approver: githubLogin, role, githubLogin, evidenceHash: hash, approvedAt: '2026-10-06T10:00:00Z' })) });
const item = (g, id) => g.results.find((r) => r.id === id);

describe('Stage 31 — REAL MONEY GATE 1 tooling', () => {
  const roots = [];
  const fixture = () => { const r = completeFixture(); roots.push(r); return r; };
  after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

  it('on this repo: CLOSED, every item PENDING-HUMAN, Gates 6 and 7 not met, live trading still locked', () => {
    const g = runGate({ root: ROOT, now: NOW });
    expect(g.verdict).to.equal('CLOSED');
    expect(g.results.map((r) => r.id)).to.deep.equal(ITEMS);
    expect(g.results.every((r) => r.status === 'PENDING-HUMAN')).to.equal(true);
    expect(item(g, 'G1-01').evidence).to.equal('NOT_MET');
    expect(item(g, 'G1-02').evidence).to.equal('MISSING');
    expect(item(g, 'G1-03').evidence).to.equal('MISSING');
    expect(item(g, 'G1-08').evidence).to.equal('OK');
  });

  it('the committed gate doc is exactly what the script generates (all PENDING-HUMAN, state table per broker, two-person procedure)', () => {
    const committed = fs.readFileSync(path.join(ROOT, 'docs/trading-agent/gates/real-money-gate-1.md'), 'utf8');
    const at = Date.parse(committed.match(/Generated: (\S+)/)[1]);
    expect(renderGateDoc(runGate({ root: ROOT, now: at })), 'regenerate: node scripts/trading/real-money-gate.mjs --now <same iso>').to.equal(committed);
    for (const id of ITEMS) expect(committed).to.match(new RegExp(`\\| ${id} \\|.*\\| \\*\\*PENDING-HUMAN\\*\\* \\|`));
    for (const b of ['Binance', 'Upstox', 'Alpaca']) expect(committed).to.match(new RegExp(`\\| ${b} \\| IMPLEMENTED/TESTED \\|.*\\| \\*\\*LOCKED\\*\\* \\| \\*\\*NO\\*\\* \\|`));
    expect(committed).to.include('## Two-person flag-enable procedure').and.include('Never by an agent, a script or CI');
  });

  it('the CLI exits non-zero while the gate is closed', () => {
    const out = path.join(fixture(), 'out.md');
    const r = spawnSync(process.execPath, [SCRIPT, '--root', ROOT, '--out', out, '--now', '2026-10-06T12:00:00Z'], { encoding: 'utf8' });
    expect(r.status).to.equal(1);
    expect(r.stdout).to.include('verdict: CLOSED');
    expect(fs.readFileSync(out, 'utf8')).to.include('**Verdict: CLOSED**');
  });

  it('a fully evidenced bundle is still CLOSED until two distinct people approve its exact hash', () => {
    const root = fixture();
    const g = runGate({ root, now: NOW });
    expect(g.results.map((r) => [r.id, r.evidence])).to.deep.equal(ITEMS.map((id) => [id, 'OK']));
    expect(g.verdict).to.equal('CLOSED');
    approve(root, g.hash, [['founder-gh', 'founder'], ['reviewer-gh', 'independent_reviewer']]);
    const g2 = runGate({ root, now: NOW });
    expect(g2.verdict).to.match(/^READY FOR FOUNDER DECISION/);
    expect(g2.results.every((r) => r.status === 'APPROVED (two-person)')).to.equal(true);
    const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--check', '--now', '2026-10-06T12:00:00Z'], { encoding: 'utf8' });
    expect(r.status).to.equal(0);
  });

  const removals = {
    'G1-01': (root) => write(root, 'docs/trading-agent/BLOCKERS.md', fs.readFileSync(path.join(root, 'docs/trading-agent/BLOCKERS.md'), 'utf8').replace('| B-05 | RESOLVED |', '| B-05 | PARTIAL |')),
    'G1-02': (root) => fs.rmSync(path.join(root, ev('gate-6.json'))),
    'G1-03': (root) => fs.rmSync(path.join(root, ev('gate-7.json'))),
    'G1-04': (root) => fs.rmSync(path.join(root, ev('broker-keys')), { recursive: true }),
    'G1-05': (root) => fs.rmSync(path.join(root, ev('egress.json'))),
    'G1-06': (root) => fs.rmSync(path.join(root, ev('suites.json'))),
    'G1-07': (root) => write(root, 'docs/trading-agent/gates/live-small-allowlist.json', { accounts: [] }),
    'G1-08': (root) => write(root, 'apps/api/src/trading_agent/flags.mjs', fs.readFileSync(path.join(root, 'apps/api/src/trading_agent/flags.mjs'), 'utf8').replace("  'LIVE_TRADING',\n", '')),
    'G1-09': (root) => fs.rmSync(path.join(root, ev('legal.json'))),
  };
  for (const id of ITEMS) {
    it(`fails closed when ${id} is missing, even with prior two-person approval`, () => {
      const root = fixture();
      approve(root, runGate({ root, now: NOW }).hash, [['founder-gh', 'founder'], ['reviewer-gh', 'independent_reviewer']]);
      removals[id](root);
      const g = runGate({ root, now: NOW });
      expect(item(g, id).evidence).to.be.oneOf(['MISSING', 'NOT_MET']);
      expect(g.results.filter((r) => r.evidence !== 'OK').map((r) => r.id)).to.deep.equal(id === 'G1-04' ? ['G1-04', 'G1-05'] : [id]);
      expect(g.verdict).to.equal('CLOSED');
      expect(g.results.every((r) => r.status === 'PENDING-HUMAN')).to.equal(true);
      // two people approving the incomplete bundle itself does not open the gate either
      approve(root, g.hash, [['founder-gh', 'founder'], ['reviewer-gh', 'independent_reviewer']]);
      const g2 = runGate({ root, now: NOW });
      expect(g2.approvals.ok).to.equal(true);
      expect(g2.verdict).to.equal('CLOSED');
      expect(g2.results.every((r) => r.status === 'PENDING-HUMAN')).to.equal(true);
    });
  }

  it('two-person rule: one person twice, a missing role or a stale hash is not enough', () => {
    const h = 'sha256:x';
    const a = (list, hash = h) => evaluateApprovals({ approvals: list.map(([githubLogin, role]) => ({ githubLogin, role, evidenceHash: hash })) }, h);
    expect(a([['founder-gh', 'founder'], ['Founder-GH', 'independent_reviewer']]).ok).to.equal(false);
    expect(a([['founder-gh', 'founder'], ['other-gh', 'founder']]).ok).to.equal(false);
    expect(a([['founder-gh', 'founder'], ['reviewer-gh', 'independent_reviewer']], 'sha256:old').ok).to.equal(false);
    expect(a([['founder-gh', 'founder'], ['reviewer-gh', 'independent_reviewer']]).ok).to.equal(true);
    expect(evaluateApprovals(null, h).ok).to.equal(false);
  });

  it('evidence changes void earlier approvals (new hash)', () => {
    const root = fixture();
    const g = runGate({ root, now: NOW });
    approve(root, g.hash, [['founder-gh', 'founder'], ['reviewer-gh', 'independent_reviewer']]);
    write(root, ev('egress.json'), { ip: IP, region: 'eu-west-1' });
    const g2 = runGate({ root, now: NOW });
    expect(g2.hash).to.not.equal(g.hash);
    expect(g2.verdict).to.equal('CLOSED');
  });

  it('key snapshots: fund-moving permissions, missing IP restriction, key material, stale capture or a different IP are refused', () => {
    const base = { enableWithdrawals: false, enableInternalTransfer: false, permitsUniversalTransfer: false, ipRestrict: true, enableSpotAndMarginTrading: true, enableReading: true };
    expect(evaluateRestrictions(base)).to.deep.equal([]);
    for (const k of ['enableWithdrawals', 'enableInternalTransfer', 'permitsUniversalTransfer']) expect(evaluateRestrictions({ ...base, [k]: true })).to.deep.equal([`${k} must be false`]);
    expect(evaluateRestrictions({ ...base, ipRestrict: false })).to.deep.equal(['ipRestrict must be true']);
    const cases = [
      (s) => ({ ...s, apiKey: 'x' }),
      (s) => ({ ...s, capturedAt: '2026-10-04T00:00:00Z' }),
      (s) => ({ ...s, keyFingerprint: 'nothex' }),
      (s) => ({ ...s, restrictions: { ...s.restrictions, enableWithdrawals: true } }),
    ];
    for (const mutate of cases) {
      const root = fixture();
      const p = ev('broker-keys/binance-a.json');
      write(root, p, mutate(JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))));
      expect(item(runGate({ root, now: NOW }), 'G1-04').evidence).to.equal('NOT_MET');
    }
    const root = fixture();
    write(root, ev('egress.json'), { ip: '198.51.100.7' });
    expect(item(runGate({ root, now: NOW }), 'G1-05').evidence).to.equal('NOT_MET');
  });

  it('LIVE_SMALL allowlist: caps above the ceilings, too many accounts or long validity are refused', () => {
    const acct = { principalId: 'prn_alice', brokerAccountId: 'bka_alice01', instruments: ['BTCUSDT'], maxOrderNotionalMinor: '5000', maxDailyNotionalMinor: '20000', expiresAt: '2026-10-20T00:00:00Z' };
    const bad = [
      [{ ...acct, maxOrderNotionalMinor: String(LIVE_SMALL_CEILINGS.maxOrderNotionalMinor + 1n) }],
      [{ ...acct, maxDailyNotionalMinor: '1.5' }],
      [{ ...acct, expiresAt: '2027-01-01T00:00:00Z' }],
      [{ ...acct, instruments: [] }],
      Array.from({ length: LIVE_SMALL_CEILINGS.maxAccounts + 1 }, (_, i) => ({ ...acct, brokerAccountId: `bka_alice0${i}` })),
    ];
    for (const accounts of bad) {
      const root = fixture();
      write(root, 'docs/trading-agent/gates/live-small-allowlist.json', { accounts });
      expect(item(runGate({ root, now: NOW }), 'G1-07').evidence).to.equal('NOT_MET');
    }
  });

  it('the tool is read-only: no env reads, no network, no subprocess, no flag writes; the committed allowlist is empty', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    for (const re of [/process\.env/, /\bfetch\s*\(/, /node:(child_process|http|https|net)/, /\bpg\b|DATABASE_URL/]) expect(src, String(re)).to.not.match(re);
    expect(src.match(/writeFileSync\(/g), 'writes only the gate doc').to.have.length(1);
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/trading-agent/gates/live-small-allowlist.json'), 'utf8')).accounts).to.deep.equal([]);
    expect(fs.existsSync(path.join(ROOT, 'docs/trading-agent/gates/evidence/approvals.json'))).to.equal(false);
  });
});
