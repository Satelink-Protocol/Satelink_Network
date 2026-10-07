import { expect } from 'chai';
import {
  decide, DecisionService, InMemoryDecisionStore, SCORECARD_CONFIG, SCORE_MEANING, DIMENSIONS, GATES, scoreDimensions,
} from '../src/trading_agent/decision/index.mjs';
import { goodInput, NOW, H, DAY } from './helpers/decision_fixture.mjs';

// Phase 6 item 6 — scorecard + hard gates + GO / WAIT / REJECT. Inputs come from the real engines.
const now = new Date(NOW);
const run = (mut) => { const i = goodInput(); if (mut) mut(i); return decide(i, { now }); };

describe('trading: scorecard + hard gates + GO/WAIT/REJECT (Phase 6 item 6)', () => {
  it('config: ten weighted dimensions summing to 100, versioned and frozen', () => {
    expect(Object.keys(SCORECARD_CONFIG.weights)).to.deep.equal([...DIMENSIONS]);
    expect(Object.values(SCORECARD_CONFIG.weights).reduce((a, b) => a + b, 0)).to.equal(100);
    expect(SCORECARD_CONFIG.version).to.equal('scorecard/1.0');
    expect(Object.isFrozen(SCORECARD_CONFIG) && Object.isFrozen(SCORECARD_CONFIG.weights)).to.equal(true);
  });

  it('healthy, fully evidenced input → GO with the documented output shape', () => {
    const d = run();
    expect(d.decision).to.equal('GO');
    expect(d.score).to.be.within(SCORECARD_CONFIG.goScore, 100);
    expect(d.confidence).to.be.within(SCORECARD_CONFIG.goConfidence, 100);
    expect(d.failed_gates).to.deep.equal([]);
    for (const k of ['decision', 'score', 'confidence', 'failed_gates', 'dimension_scores', 'strategy_version', 'data_timestamp', 'expires_at', 'evidence_refs', 'explanation']) expect(d).to.have.property(k);
    expect(Object.keys(d.dimension_scores)).to.deep.equal([...DIMENSIONS]);
    expect(d.strategy_version).to.equal('stv_1');
    expect(d.evidence_refs.some((r) => r.startsWith('backtest:sha256:'))).to.equal(true);
    expect(d.evidence_refs.some((r) => r.startsWith('risk:risk-checks/1.0:APPROVE'))).to.equal(true);
  });

  it('the score is documented as decision quality, NOT a probability of profit', () => {
    const d = run();
    expect(d.scoreMeaning).to.equal(SCORE_MEANING).and.match(/NOT a probability of profit/);
    expect(d.explanation).to.match(/not a probability of profit/);
  });

  describe('hard gates: any failure → REJECT, however high the score', () => {
    const cases = [
      ['risk:kill_switch', (i) => { i.riskContext.policy.killSwitch = true; }],
      ['kill_switch', (i) => { i.riskContext.killSwitchEvents = [{ seq: 1, scopeType: 'global', scopeId: null, principalId: null, action: 'engage', source: 'admin', reason: 'halt' }]; }],
      ['stale_data', (i) => { i.dataConfidence = { ...i.dataConfidence, parts: { ...i.dataConfidence.parts, freshness: 0 } }; }],
      ['stale_data', (i) => { i.dataConfidence = null; }],
      ['broker_unavailable', (i) => { i.broker = { status: 'degraded' }; }],
      ['insufficient_liquidity', (i) => { i.liquidity = { ...i.liquidity, flags: ['insufficient_liquidity'] }; }],
      ['abnormal_spread', (i) => { i.liquidity = { ...i.liquidity, flags: ['abnormal_spread'] }; }],
      ['mandate_expired', (i) => { i.riskContext.mandate.validUntil = NOW - 1; }],
      ['mandate_expired', (i) => { i.riskContext.mandate.status = 'revoked'; }],
      ['validation_expired', (i) => { i.validationTimes.stress = new Date(NOW - 8 * DAY).toISOString(); }],
      ['validation_expired', (i) => { delete i.validationTimes.walk_forward; }],
      ['risk', (i) => { i.order = null; }],
    ];
    for (const [gate, mut] of cases) {
      it(`${gate} → REJECT`, () => {
        const d = run(mut);
        expect(d.decision).to.equal('REJECT');
        expect(d.failed_gates.some((g) => g === gate || g.startsWith(`${gate}:`))).to.equal(true);
      });
    }

    it('PROPERTY: with every dimension forced to 100, any single failed gate still REJECTs', () => {
      const gates = new Set();
      for (const [, mut] of cases) {
        const i = goodInput(); mut(i);
        const d = decide(i, { now, cfg: { ...SCORECARD_CONFIG, goScore: 0, goConfidence: 0 } });
        expect(d.decision).to.equal('REJECT');
        d.failed_gates.forEach((g) => gates.add(g.split(':')[0]));
      }
      for (const g of GATES) expect([...gates], g).to.include(g);
    });

    it('the risk gate is the Stage 15 engine itself (e.g. an order over the mandate cap)', () => {
      const d = run((i) => { i.order.quantity = '1'; }); // 30 000 USDT ≫ caps
      expect(d.decision).to.equal('REJECT');
      expect(d.failed_gates.find((g) => g.startsWith('risk:'))).to.be.a('string');
    });
  });

  describe('WAIT', () => {
    it('no gate fails but the score is below the GO threshold → WAIT', () => {
      const d = run((i) => { i.portfolioFit = { score: 0, configVersion: 'portfolio-fit/1.0' }; i.regime = { ...i.regime, primary: 'uncertain', labels: ['uncertain'] }; i.strategy.preferredRegimes = ['trending']; });
      expect(d.failed_gates).to.deep.equal([]);
      expect(d.decision).to.equal(d.score < SCORECARD_CONFIG.goScore || d.confidence < SCORECARD_CONFIG.goConfidence ? 'WAIT' : 'GO');
      const forced = decide(goodInput(), { now, cfg: { ...SCORECARD_CONFIG, goScore: 99 } });
      expect(forced.decision).to.equal('WAIT');
    });
    it('confidence below threshold (thin sample, no walk-forward agreement) → WAIT', () => {
      const d = decide(goodInput(), { now, cfg: { ...SCORECARD_CONFIG, goConfidence: 99 } });
      expect(d.decision).to.equal('WAIT');
    });
  });

  it('a missing input is null and lowers confidence — never silently neutral', () => {
    const full = run();
    const d = run((i) => { i.portfolioFit = null; i.liquidity = { ...i.liquidity, fill: null }; });
    expect(d.dimension_scores.portfolio_fit).to.equal(null);
    expect(d.dimension_scores.execution_quality).to.equal(null);
    expect(d.confidence).to.equal(full.confidence - 10);
    expect(d.score).to.be.below(full.score);
    const exact = Math.floor(DIMENSIONS.reduce((acc, k) => acc + (d.dimension_scores[k] ?? 0) * SCORECARD_CONFIG.weights[k], 0) / 100);
    expect(d.score).to.equal(exact); // missing dimensions contribute exactly 0
  });

  it('expires at the earliest of TTL, mandate expiry and validation expiry', () => {
    expect(run().expires_at).to.equal(new Date(NOW + SCORECARD_CONFIG.decisionTtlMs).toISOString());
    expect(run((i) => { i.riskContext.mandate.validUntil = NOW + 60_000; }).expires_at).to.equal(new Date(NOW + 60_000).toISOString());
  });

  it('is deterministic: same input → identical decision and input hash; the clock does not change the hash', () => {
    const a = run(); const b = run();
    expect(a).to.deep.equal(b);
    const c = run((i) => { i.riskContext.now = NOW + 1; });
    expect(c.input_hash).to.equal(a.input_hash);
    expect(run((i) => { i.order.quantity = '0.02'; }).input_hash).to.not.equal(a.input_hash);
  });

  it('dimension scoring is pure and bounded 0–100', () => {
    const dims = scoreDimensions(goodInput(), SCORECARD_CONFIG);
    for (const k of DIMENSIONS) expect(dims[k]).to.be.within(0, 100);
  });

  describe('DecisionService (persist every decision)', () => {
    let n = 0;
    const ids = (p) => `${p}_${++n}`;
    it('persists every decision with an explanation reference', async () => {
      const store = new InMemoryDecisionStore();
      const svc = new DecisionService({ store, idFactory: ids, clock: () => now });
      const go = await svc.evaluate(goodInput());
      const rej = await svc.evaluate((() => { const i = goodInput(); i.broker = { status: 'down' }; return i; })());
      expect(store.rows.map((r) => r.decision)).to.deep.equal(['GO', 'REJECT']);
      expect(go.explanation_ref).to.equal(`decision:${go.id}:explanation`);
      expect(rej.failed_gates).to.include('broker_unavailable');
    });
    it('an unrecorded decision is never GO (store failure → REJECT record_failed)', async () => {
      const svc = new DecisionService({ store: { insert: async () => { throw new Error('db down'); } }, idFactory: ids, clock: () => now });
      const d = await svc.evaluate(goodInput());
      expect(d.decision).to.equal('REJECT');
      expect(d.failed_gates).to.include('record_failed');
      expect(d.recorded).to.equal(false);
    });
  });
});
