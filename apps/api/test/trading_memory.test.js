import { expect } from 'chai';
import {
  MemoryService, InMemoryMemoryStore, predictivenessReport, proposeWeights, runFeedback, decideCalibration, proposeStrategyRevision, FEEDBACK_CONFIG,
} from '../src/trading_agent/memory/index.mjs';
import { SCORECARD_CONFIG, DIMENSIONS, decide } from '../src/trading_agent/decision/index.mjs';
import { StrategyService, InMemoryStrategyStore, LifecycleState as S } from '../src/trading_agent/strategies/index.mjs';
import { tradingFlagEnvName } from '../src/trading_agent/flags.mjs';
import { goodInput, NOW } from './helpers/decision_fixture.mjs';

// Phase 6 item 9 — trading memory + feedback / calibration. Synthetic data.
const now = new Date(NOW);
const mk = () => { let n = 0; const store = new InMemoryMemoryStore(); const ids = (p) => `${p}_${String(++n).padStart(5, '0')}`; return { store, ids, mem: new MemoryService({ store, idFactory: ids, clock: () => now }) }; };
const dims = (over = {}) => Object.fromEntries(DIMENSIONS.map((k) => [k, over[k] ?? 60]));
const decision = (id, d, over = {}) => ({ id, decision: 'GO', score: 70, dimension_scores: d, evidence_refs: [`backtest:${id}`], strategy_version: 'stv_1', subject: { principalId: 'prn_alice', opportunityId: `opp_${id}` }, ...over });
const code = async (fn) => { try { await fn(); } catch (e) { return e.code; } return null; };

/** n decisions where out_of_sample is high on wins (80) and low on losses (40); everything else equal. */
async function seedLabeled(mem, n, { signal = true } = {}) {
  for (let i = 0; i < n; i += 1) {
    const win = i % 2 === 0;
    const id = `dec_${String(i).padStart(4, '0')}`;
    await mem.recordDecision(decision(id, dims({ out_of_sample: signal ? (win ? 80 : 40) : 60 })));
    await mem.recordOutcome({ decisionId: id, principalId: 'prn_alice', outcome: win ? 'profit' : 'loss', pnl: win ? '12.5' : '-10' });
  }
}

describe('trading: memory + feedback (Phase 6 item 9)', () => {
  describe('memory', () => {
    it('profile is upserted with an increasing version; invalid tolerance refused', async () => {
      const { mem } = mk();
      expect((await mem.setProfile({ principalId: 'prn_alice', riskTolerance: 'low', maxLoss: '200', markets: ['BTC-USDT'] })).version).to.equal(1);
      expect((await mem.setProfile({ principalId: 'prn_alice', riskTolerance: 'medium', maxLoss: '300' })).version).to.equal(2);
      expect(await code(() => mem.setProfile({ principalId: 'prn_alice', riskTolerance: 'yolo' }))).to.equal('INVALID');
    });
    it('opportunity → decision → authorization → outcome; exactly one outcome per decision', async () => {
      const { mem, store } = mk();
      await mem.recordDecision(decision('dec_1', dims()));
      await mem.recordAuthorization({ decisionId: 'dec_1', principalId: 'prn_alice', mandateId: 'mdt_1' });
      await mem.recordOutcome({ decisionId: 'dec_1', principalId: 'prn_alice', outcome: 'profit', pnl: '5' });
      expect(store.rows.decision_memory.map((r) => r.entryKind)).to.deep.equal(['decision', 'authorization', 'outcome']);
      expect(await mem.recordOutcome({ decisionId: 'dec_1', principalId: 'prn_alice', outcome: 'loss' }).then(() => null, (e) => e.message)).to.match(/already recorded/);
      expect(await code(() => mem.recordOutcome({ decisionId: 'dec_2', principalId: 'prn_alice', outcome: 'win' }))).to.equal('INVALID');
    });
    it('retrieval is structured and bounded — summaries + recent rows, never chat history', async () => {
      const { mem } = mk();
      await mem.setProfile({ principalId: 'prn_alice', riskTolerance: 'low', maxLoss: '200', markets: ['BTC-USDT'] });
      await seedLabeled(mem, 40);
      await mem.recordTrade({ principalId: 'prn_alice', instrument: 'BTC-USDT', pnl: '10.10', closedAt: now.toISOString() });
      await mem.recordTrade({ principalId: 'prn_alice', instrument: 'BTC-USDT', pnl: '-0.05', closedAt: now.toISOString() });
      await mem.recordStrategyEvidence({ strategyVersionId: 'stv_1', kind: 'backtest', metrics: { returnPct: '2.7' }, failureModes: ['cost_sensitive'] });
      await mem.recordError({ scope: 'oms', code: 'VENUE_TIMEOUT', principalId: 'prn_alice', context: { secret: 'never-surfaced' } });
      const ctx = await mem.contextFor({ principalId: 'prn_alice', strategyVersionId: 'stv_1', limit: 999 });
      expect(ctx.decisions.total).to.equal(40);
      expect(ctx.decisions.byOutcome).to.deep.equal({ profit: 20, loss: 20 });
      expect(ctx.decisions.recent).to.have.length(25); // bounded
      expect(ctx.trades.netPnl).to.equal('10.05'); // exact fixed-point
      expect(ctx.strategy.failureModes).to.deep.equal(['cost_sensitive']);
      expect(ctx.errors).to.deep.equal([{ scope: 'oms', code: 'VENUE_TIMEOUT' }]);
      expect(JSON.stringify(ctx)).to.not.match(/never-surfaced|"messages"|"chat"|"transcript"/);
      expect(ctx.summary).to.equal('Profile: low risk, max loss 200 USDT, markets BTC-USDT. 40 past decisions (profit 20, loss 20). 2 closed trades, net P&L 10.05. Strategy stv_1: evidence backtest; failure modes cost_sensitive. Recent errors: VENUE_TIMEOUT.');
    });
  });

  describe('feedback → calibration proposal', () => {
    it('too few labeled outcomes → insufficient_data, no proposal', async () => {
      const { mem, store, ids } = mk();
      await seedLabeled(mem, 20);
      const r = await runFeedback({ store, idFactory: ids, clock: () => now });
      expect(r.status).to.equal('insufficient_data');
      expect(store.rows.calibration_proposals).to.have.length(0);
    });
    it('flat / not_executed / WAIT decisions are not labels', async () => {
      const { mem, store } = mk();
      await mem.recordDecision(decision('d_flat', dims())); await mem.recordOutcome({ decisionId: 'd_flat', principalId: 'prn_alice', outcome: 'flat' });
      await mem.recordDecision(decision('d_ne', dims())); await mem.recordOutcome({ decisionId: 'd_ne', principalId: 'prn_alice', outcome: 'not_executed' });
      await mem.recordDecision(decision('d_wait', dims(), { decision: 'WAIT' })); await mem.recordOutcome({ decisionId: 'd_wait', principalId: 'prn_alice', outcome: 'profit' });
      expect(predictivenessReport(await store.all('decision_memory')).labeled).to.equal(0);
    });
    it('a predictive dimension gains weight in a NEW pending version; the live config is unchanged', async () => {
      const { mem, store, ids } = mk();
      await seedLabeled(mem, 40);
      const r = await runFeedback({ store, idFactory: ids, clock: () => now });
      expect(r.status).to.equal('proposed');
      expect(r.report.dimensions.out_of_sample).to.deep.equal({ meanOnWins: 80, meanOnLosses: 40, separation: 40 });
      expect(r.proposal).to.include({ fromVersion: 'scorecard/1.0', toVersion: 'scorecard/1.1', status: 'pending_human_approval' });
      expect(Object.values(r.proposal.weights).reduce((a, b) => a + b, 0)).to.equal(100);
      expect(r.proposal.weights.out_of_sample).to.be.greaterThan(SCORECARD_CONFIG.weights.out_of_sample);
      expect(SCORECARD_CONFIG.version).to.equal('scorecard/1.0'); // nothing applied
      expect(store.rows.calibration_proposals).to.have.length(1);
    });
    it('no dimension separates wins from losses → no_signal, no proposal', async () => {
      const { mem, store, ids } = mk();
      await seedLabeled(mem, 40, { signal: false });
      expect((await runFeedback({ store, idFactory: ids, clock: () => now })).status).to.equal('no_signal');
      expect(proposeWeights({ dimensions: Object.fromEntries(DIMENSIONS.map((k) => [k, { separation: -3 }])) })).to.equal(null);
    });
  });

  describe('calibration approval (human + step-up only)', () => {
    const setup = async () => {
      const { mem, store, ids } = mk();
      await seedLabeled(mem, 40);
      const { proposal } = await runFeedback({ store, idFactory: ids, clock: () => now });
      const base = { store, proposal, isStaff: async (p) => p === 'prn_admin', stepUp: { verify: async ({ code: c }) => (c === '123456' ? { ok: true, method: 'totp' } : { ok: false }) }, clock: () => now };
      return { store, proposal, base };
    };
    it('agents, machines, non-staff and failed step-up cannot approve', async () => {
      const { base } = await setup();
      expect(await code(() => decideCalibration({ ...base, decision: 'approved', actor: { kind: 'agent', principalId: 'prn_bot' }, code: '123456' }))).to.equal('FORBIDDEN');
      expect(await code(() => decideCalibration({ ...base, decision: 'approved', actor: { kind: 'platform', principalId: 'prn_system' }, code: '123456' }))).to.equal('FORBIDDEN');
      expect(await code(() => decideCalibration({ ...base, decision: 'approved', actor: { kind: 'human', principalId: 'prn_alice' }, code: '123456' }))).to.equal('FORBIDDEN');
      const everyoneStaff = { ...base, isStaff: async () => true };
      expect(await code(() => decideCalibration({ ...everyoneStaff, decision: 'approved', actor: { kind: 'agent', principalId: 'prn_admin' }, code: '123456' }))).to.equal('FORBIDDEN'); // human-only, even if the id is staff
      expect(await code(() => decideCalibration({ ...everyoneStaff, decision: 'approved', actor: { kind: 'platform', principalId: 'prn_admin' }, code: '123456' }))).to.equal('FORBIDDEN');
      expect(await code(() => decideCalibration({ ...base, decision: 'approved', actor: { kind: 'human', principalId: 'prn_admin' }, code: '000000' }))).to.equal('STEP_UP_FAILED');
    });
    it('staff approval returns the NEW frozen config (scorecard/1.1) — usable by the scorecard; decided once', async () => {
      const { base, store } = await setup();
      const cfg = await decideCalibration({ ...base, decision: 'approved', actor: { kind: 'human', principalId: 'prn_admin' }, code: '123456' });
      expect(cfg.version).to.equal('scorecard/1.1');
      expect(Object.isFrozen(cfg) && Object.isFrozen(cfg.weights)).to.equal(true);
      expect(decide(goodInput(), { now, cfg }).config_version).to.equal('scorecard/1.1');
      expect(store.rows.calibration_decisions).to.have.length(1);
      expect(await decideCalibration({ ...base, decision: 'rejected', actor: { kind: 'human', principalId: 'prn_admin' }, code: '123456' }).then(() => null, (e) => e.message)).to.match(/already decided/);
    });
    it('a proposal made against another live version is a CONFLICT; a rejection applies nothing', async () => {
      const { base } = await setup();
      expect(await code(() => decideCalibration({ ...base, decision: 'approved', actor: { kind: 'human', principalId: 'prn_admin' }, code: '123456', current: { ...SCORECARD_CONFIG, version: 'scorecard/1.4' } }))).to.equal('CONFLICT');
      const { base: b2 } = await setup();
      expect(await decideCalibration({ ...b2, decision: 'rejected', actor: { kind: 'human', principalId: 'prn_admin' }, code: '123456' })).to.equal(null);
    });
  });

  describe('strategy improvement = new version that must re-validate (no silent live mutation)', () => {
    const DSL = (stop = '50') => ({
      dsl: 'satelink.strategy/1.0', name: 'Band', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
      entry: { cmp: { op: 'lt', left: { price: 'close' }, right: { const: '97' } } },
      exit: { cmp: { op: 'gt', left: { price: 'close' }, right: { const: '103' } } },
      position: { side: 'long', sizing: { mode: 'fixed_quantity', quantity: '1' } }, risk: { stopLossPct: stop },
    });
    const alice = { principalId: 'prn_alice', kind: 'human' };
    const strategiesSvc = () => { let n = 0; return new StrategyService({ store: new InMemoryStrategyStore(), clock: () => now, idFactory: (p) => `${p}_${String(++n).padStart(4, '0')}`, env: { [tradingFlagEnvName('TRADING_AGENT')]: 'true' } }); };

    it('v(n+1) starts at DRAFT; the running version is untouched; v(n+1) cannot skip validation', async () => {
      const { mem } = mk();
      const strategies = strategiesSvc();
      const s = await strategies.createStrategy({ actor: alice, name: 'Band' });
      const v1 = await strategies.createVersion({ actor: alice, strategyId: s.id, dsl: DSL() });
      await strategies.transition({ actor: alice, versionId: v1.id, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence: { backtest: { backtestId: 'bkt_00000001', definitionHash: v1.definitionHash, bars: 1000, passed: true } } });
      await strategies.transition({ actor: alice, versionId: v1.id, to: S.PAPER, expectedFrom: S.BACKTESTED, evidence: { approval: { approvedBy: 'prn_alice', note: 'go' } } });
      const before = await strategies.getVersion(v1.id);
      const rev = await proposeStrategyRevision({ strategies, memory: mem, actor: alice, strategyId: s.id, fromVersionId: v1.id, dsl: DSL('20'), reason: 'tighter stop after review' });
      expect(rev).to.include({ version: 2, state: 'DRAFT', revisionOf: v1.id, mustRevalidate: true });
      const after = await strategies.getVersion(v1.id);
      expect(after).to.deep.equal(before); // definition, hash and state unchanged
      expect(after.state).to.equal(S.PAPER);
      expect((await strategies.getVersion(rev.versionId)).state).to.equal(S.DRAFT);
      // skipping BACKTESTED, or reusing v1's evidence, is refused
      expect(await strategies.transition({ actor: alice, versionId: rev.versionId, to: S.PAPER, expectedFrom: S.DRAFT, evidence: { approval: { approvedBy: 'prn_alice', note: 'x' } } }).then(() => null, (e) => e.code)).to.equal('ILLEGAL_TRANSITION');
      expect(await strategies.transition({ actor: alice, versionId: rev.versionId, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence: { backtest: { backtestId: 'bkt_00000001', definitionHash: v1.definitionHash, bars: 1000, passed: true } } }).then(() => null, (e) => e.code)).to.equal('GUARD_FAILED');
    });
    it('there is no update path for a version, and an identical revision is NO_CHANGE', async () => {
      const { mem } = mk();
      const strategies = strategiesSvc();
      expect(Object.getOwnPropertyNames(StrategyService.prototype).filter((m) => /update|edit|mutate|patch/i.test(m))).to.deep.equal([]);
      const s = await strategies.createStrategy({ actor: alice, name: 'Band' });
      const v1 = await strategies.createVersion({ actor: alice, strategyId: s.id, dsl: DSL() });
      expect(await code(() => proposeStrategyRevision({ strategies, memory: mem, actor: alice, strategyId: s.id, fromVersionId: v1.id, dsl: DSL(), reason: 'same' }))).to.equal('NO_CHANGE');
    });
  });

  it('feedback config is versioned', () => expect(FEEDBACK_CONFIG.version).to.equal('feedback/1.0'));
});
