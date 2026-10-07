import { expect } from 'chai';
import { evaluateChecks, RiskEngine, InMemoryRiskStore, MODE_B_CAPS, CHECKS, CHECKS_VERSION } from '../src/trading_agent/risk/index.mjs';
import { isTradingFlagEnabled, tradingFlagEnvName as F, LOCKED_TRADING_FLAGS } from '../src/trading_agent/flags.mjs';
import { ORDER, RISK_CTX, NOW, DAY } from './helpers/decision_fixture.mjs';

// Phase 6 item 12 — Mode B for agent / machine proposals (reviewed change to the Stage 15 engine).
const MODE_B_ORDER = () => {
  const o = { ...ORDER(), origin: 'agent_proposal', proposedBy: 'prn_bot', decisionId: 'dec_000001', strategyVersionId: 'stv_1', quantity: '0.001', limitPrice: '30000' }; // 30 USDT
  delete o.approvedBy;
  return o;
};
const MODE_B_CTX = () => {
  const c = RISK_CTX();
  c.flagsEnv[F('MANDATE_MODE_B')] = 'true';
  c.mandate = { ...c.mandate, mode: 'automated', termsMode: 'B', stepUpMethod: 'totp', strategyVersionId: 'stv_1', instruments: ['BTC-USDT'] };
  c.activity = { ...c.activity, todayNotionalMinor: '0' };
  c.proposer = { principalId: 'prn_bot', ownerPrincipalId: 'prn_alice', scope: 'EXECUTE_UNDER_MANDATE', mandateId: 'mdt_1' };
  c.scorecardDecision = { id: 'dec_000001', decision: 'GO', expires_at: new Date(NOW + 10 * 60_000).toISOString(), subject: { principalId: 'prn_alice', instrument: 'BTC-USDT', side: 'buy' } };
  return c;
};
function run(mutate) { const o = MODE_B_ORDER(); const c = MODE_B_CTX(); if (mutate) mutate(o, c); return evaluateChecks(o, c); }
const failed = (r) => [r.decision, r.failed?.id, r.failed?.code];

describe('trading: Mode B for agents / machines (Phase 6 item 12)', () => {
  it('MANDATE_MODE_B is a new flag, default OFF and not locked; the checks are versioned 1.1 and still 20', () => {
    expect(isTradingFlagEnabled('MANDATE_MODE_B', {})).to.equal(false);
    expect(LOCKED_TRADING_FLAGS.has('MANDATE_MODE_B')).to.equal(false);
    expect(CHECKS).to.have.length(20);
    expect(CHECKS_VERSION).to.equal('risk-checks/1.1');
  });

  it('APPROVE when every condition holds: Mode B mandate, authorised proposer, current GO, within LIVE_SMALL caps, paper', () => {
    const r = run();
    expect(r.decision).to.equal('APPROVE');
    expect(r.trace.every((t) => t.outcome === 'pass')).to.equal(true);
  });

  const refusals = [
    ['flag off', (o, c) => { delete c.flagsEnv[F('MANDATE_MODE_B')]; }, ['REJECT', 'trading_flags', 'FLAG_DISABLED']],
    ['live mode (LIVE_TRADING is LOCKED even if set)', (o, c) => { o.mode = 'live'; c.brokerAccount.environment = 'live'; c.flagsEnv[F('LIVE_TRADING')] = 'true'; }, ['REJECT', 'trading_flags', 'FLAG_DISABLED']],
    ['any other origin without approval needs AUTONOMOUS_MODE (LOCKED)', (o) => { o.origin = 'llm_proposal'; }, ['REJECT', 'trading_flags', 'FLAG_DISABLED']],
    ['copilot mandate', (o, c) => { c.mandate.mode = 'copilot'; }, ['REJECT', 'mandate', 'APPROVAL_REQUIRED']],
    ['Mode A terms', (o, c) => { c.mandate.termsMode = 'A'; }, ['REJECT', 'mandate', 'MODE_B_MANDATE_REQUIRED']],
    ['Mode C terms', (o, c) => { c.mandate.termsMode = 'C'; }, ['REJECT', 'mandate', 'MODE_B_MANDATE_REQUIRED']],
    ['mandate not step-up signed', (o, c) => { c.mandate.stepUpMethod = 'none'; }, ['REJECT', 'mandate', 'MANDATE_NOT_APPROVED']],
    ['mandate expired', (o, c) => { c.mandate.validUntil = NOW - 1; }, ['REJECT', 'mandate', 'MANDATE_EXPIRED']],
    ['mandate revoked', (o, c) => { c.mandate.status = 'revoked'; }, ['REJECT', 'mandate', 'MANDATE_INACTIVE']],
    ['other strategy version', (o) => { o.strategyVersionId = 'stv_2'; }, ['REJECT', 'mandate', 'MODE_B_STRATEGY_MISMATCH']],
    ['instrument outside the mandate', (o, c) => { c.mandate.instruments = ['ETH-USDT']; }, ['REJECT', 'mandate', 'MODE_B_INSTRUMENT']],
    ['no proposer context', (o, c) => { delete c.proposer; }, ['REJECT', 'mandate', 'MODE_B_PROPOSER']],
    ['proposer key only PROPOSE scope', (o, c) => { c.proposer.scope = 'PROPOSE'; }, ['REJECT', 'mandate', 'MODE_B_PROPOSER']],
    ['proposer key bound to another mandate', (o, c) => { c.proposer.mandateId = 'mdt_9'; }, ['REJECT', 'mandate', 'MODE_B_PROPOSER']],
    ['proposer owned by someone else', (o, c) => { c.proposer.ownerPrincipalId = 'prn_eve'; }, ['REJECT', 'mandate', 'MODE_B_PROPOSER']],
    ['order names a different proposer', (o) => { o.proposedBy = 'prn_other'; }, ['REJECT', 'mandate', 'MODE_B_PROPOSER']],
    ['no scorecard decision', (o, c) => { delete c.scorecardDecision; }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['scorecard WAIT', (o, c) => { c.scorecardDecision.decision = 'WAIT'; }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['scorecard REJECT', (o, c) => { c.scorecardDecision.decision = 'REJECT'; }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['scorecard GO expired', (o, c) => { c.scorecardDecision.expires_at = new Date(NOW).toISOString(); }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['scorecard GO for the other side', (o, c) => { c.scorecardDecision.subject.side = 'sell'; }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['scorecard GO for another instrument', (o, c) => { c.scorecardDecision.subject.instrument = 'ETH-USDT'; }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['scorecard GO is a different decision', (o) => { o.decisionId = 'dec_999999'; }, ['REJECT', 'mandate', 'MODE_B_SCORECARD']],
    ['above the LIVE_SMALL per-order cap', (o) => { o.quantity = '0.002'; }, ['REJECT', 'mandate', 'MODE_B_CAP']], // 60 > 50
    ['would exceed the LIVE_SMALL daily cap', (o, c) => { c.activity.todayNotionalMinor = '17500'; }, ['REJECT', 'mandate', 'MODE_B_CAP']], // 175 + 30 > 200
    ['global kill switch still wins (check 1)', (o, c) => { c.killSwitchEvents = [{ seq: 1, scopeType: 'global', scopeId: null, principalId: null, action: 'engage', source: 'admin', reason: 'halt' }]; }, ['REJECT', 'kill_switch', 'KILL_SWITCH']],
  ];
  for (const [name, mut, expected] of refusals) {
    it(`refuses: ${name}`, () => expect(failed(run(mut))).to.deep.equal(expected));
  }

  it('defence in depth: check 7 alone refuses an unapproved non-Mode-B order even if check 3 were bypassed', () => {
    const mandateCheck = CHECKS.find((c) => c.id === 'mandate').fn;
    const o = MODE_B_ORDER(); o.origin = 'llm_proposal';
    expect(mandateCheck(o, MODE_B_CTX())).to.deep.include({ ok: false, code: 'APPROVAL_REQUIRED' });
    expect(mandateCheck(MODE_B_ORDER(), MODE_B_CTX())).to.deep.equal({ ok: true });
  });

  it('caps are the LIVE_SMALL ceilings (50 per order, 200 per day)', () => {
    expect(MODE_B_CAPS).to.deep.equal({ maxOrderNotional: '50', maxDailyNotional: '200' });
    expect(run((o) => { o.quantity = '0.0016'; }).decision).to.equal('APPROVE'); // 48 ≤ 50
  });

  it('human-approved orders are unchanged by Mode B (copilot path still requires the owner)', () => {
    const c = RISK_CTX();
    expect(evaluateChecks(ORDER(), c).decision).to.equal('APPROVE');
    const o = ORDER(); o.approvedBy = 'prn_eve';
    expect(failed(evaluateChecks(o, c))).to.deep.equal(['REJECT', 'mandate', 'APPROVAL_REQUIRED']);
  });

  it('the RiskEngine records Mode B approvals and refusals (fail-closed wrapper unchanged)', async () => {
    const store = new InMemoryRiskStore();
    let n = 0;
    const ok = await new RiskEngine({ loadContext: async () => MODE_B_CTX(), store, idFactory: (p) => `${p}_${++n}`, clock: () => new Date(NOW) }).decide(MODE_B_ORDER());
    expect(ok.decision).to.equal('APPROVE');
    const bad = await new RiskEngine({ loadContext: async () => { const c = MODE_B_CTX(); c.scorecardDecision.decision = 'WAIT'; return c; }, store, idFactory: (p) => `${p}_${++n}`, clock: () => new Date(NOW) }).decide(MODE_B_ORDER());
    expect(bad.decision).to.equal('REJECT');
    expect(store.decisions.map((d) => d.decision)).to.deep.equal(['APPROVE', 'REJECT']);
    expect(store.decisions[1].failedCheck.code).to.equal('MODE_B_SCORECARD');
  });

  it('expiry boundary: a GO expiring after now passes; one day later it is refused', () => {
    expect(run().decision).to.equal('APPROVE');
    expect(failed(run((o, c) => { c.now = NOW + DAY; c.quote.sourceTime = NOW + DAY - 500; c.mandate.validUntil = NOW + 2 * DAY; }))[2]).to.equal('MODE_B_SCORECARD');
    expect(failed(run((o, c) => { c.now = NOW + DAY; c.quote.sourceTime = NOW + DAY - 500; }))[2]).to.equal('MANDATE_EXPIRED'); // the mandate window is checked first
  });
});
