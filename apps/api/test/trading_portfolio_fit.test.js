import { expect } from 'chai';
import { assessPortfolioFit, correlation, PORTFOLIO_FIT_CONFIG } from '../src/trading_agent/portfolio/index.mjs';
import { decide } from '../src/trading_agent/decision/index.mjs';
import { toDecimal } from '../src/trading_agent/strategies/fixed.mjs';
import { goodInput, NOW } from './helpers/decision_fixture.mjs';

// Phase 6 item 7 — portfolio fit + correlation. Hand-checkable values.
const ret = (n, f) => Array.from({ length: n }, (_, i) => f(i).toFixed(6));
const wave = ret(40, (i) => 0.01 * Math.sin(i));
const base = (over = {}) => ({
  equity: '10000',
  positions: [{ instrument: 'ETH-USDT', quantity: '1', avgEntryPrice: '1000', mark: '1000' }], // 1 000 long = 10% of equity
  candidate: { instrument: 'BTC-USDT', side: 'buy', notional: '1000', strategyId: 'stg_new' },
  ...over,
});

describe('trading: portfolio fit + correlation (Phase 6 item 7)', () => {
  describe('correlation', () => {
    it('identical → 1, inverted → −1, constant → null (undefined), exact on a hand case', () => {
      expect(toDecimal(correlation(wave, wave))).to.equal('1');
      expect(toDecimal(correlation(wave, wave.map((x) => (-Number(x)).toFixed(6))))).to.equal('-1');
      expect(correlation(wave, wave.map(() => '0.01'))).to.equal(null);
      // x = 1,2,3 ; y = 2,4,7 → r = 0.9933992677…
      expect(Number(toDecimal(correlation(['1', '2', '3'], ['2', '4', '7'])))).to.be.closeTo(0.993399267798783, 1e-12);
      expect(correlation(['1'], ['1'])).to.equal(null);
    });
  });

  describe('exposure + concentration (hard gate input)', () => {
    it('exposure before/after and percentages are exact', () => {
      const f = assessPortfolioFit(base());
      expect(f.exposure).to.deep.equal({ grossBefore: '1000', grossAfter: '2000' });
      expect(f.concentration).to.include({ verdict: 'pass', instrumentPct: '10', grossExposurePct: '20', hhi: '0.5' });
      expect(f.configVersion).to.equal(PORTFOLIO_FIT_CONFIG.version);
    });
    it('one instrument above 35% of equity after the trade → fail', () => {
      const f = assessPortfolioFit(base({ candidate: { instrument: 'BTC-USDT', side: 'buy', notional: '3600' } }));
      expect(f.concentration).to.include({ verdict: 'fail', instrumentPct: '36' });
      expect(f.concentration.flags).to.deep.equal(['instrument_concentration']);
    });
    it('adding to an existing position counts the combined exposure', () => {
      const f = assessPortfolioFit(base({ candidate: { instrument: 'ETH-USDT', side: 'buy', notional: '2600' } })); // 1 000 + 2 600 = 36%
      expect(f.concentration.instrumentPct).to.equal('36');
      expect(f.concentration.verdict).to.equal('fail');
    });
    it('gross exposure above 100% of equity → fail', () => {
      const positions = ['A', 'B', 'C'].map((x) => ({ instrument: `${x}-USDT`, quantity: '1', avgEntryPrice: '3400', mark: '3400' }));
      const f = assessPortfolioFit(base({ positions, candidate: { instrument: 'D-USDT', side: 'buy', notional: '1000' } }));
      expect(f.concentration.flags).to.deep.equal(['gross_exposure']);
    });
    it('reducing a position lowers concentration (a sell against a long)', () => {
      const f = assessPortfolioFit(base({ candidate: { instrument: 'ETH-USDT', side: 'sell', notional: '500' } }));
      expect(f.concentration.instrumentPct).to.equal('5');
      expect(f.exposure.grossAfter).to.equal('500');
    });
  });

  describe('correlation to held positions + strategy overlap → score', () => {
    it('a candidate highly correlated with a held long loses correlation points', () => {
      const f = assessPortfolioFit(base({ returns: { 'BTC-USDT': wave, 'ETH-USDT': wave } }));
      expect(f.correlation.weighted).to.equal('1');
      expect(f.penalties.correlation).to.equal(PORTFOLIO_FIT_CONFIG.penalties.correlation);
    });
    it('the same correlation against a held SHORT is a hedge (sign flipped, no penalty)', () => {
      const f = assessPortfolioFit(base({ positions: [{ instrument: 'ETH-USDT', quantity: '-1', avgEntryPrice: '1000', mark: '1000' }], returns: { 'BTC-USDT': wave, 'ETH-USDT': wave } }));
      expect(f.correlation.weighted).to.equal('-1');
      expect(f.penalties.correlation).to.equal(0);
    });
    it('too few aligned returns → correlation unknown (no credit, no penalty)', () => {
      const f = assessPortfolioFit(base({ returns: { 'BTC-USDT': wave.slice(0, 5), 'ETH-USDT': wave.slice(0, 5) } }));
      expect(f.correlation.weighted).to.equal(null);
      expect(f.correlation.pairs).to.deep.equal([{ instrument: 'ETH-USDT', correlation: null }]);
    });
    it('other active strategies on the same instrument are overlap', () => {
      const f = assessPortfolioFit(base({ activeStrategies: [{ strategyId: 'stg_a', instruments: ['BTC-USDT'] }, { strategyId: 'stg_b', instruments: ['SOL-USDT'] }, { strategyId: 'stg_new', instruments: ['BTC-USDT'] }] }));
      expect(f.overlap.strategies).to.deep.equal(['stg_a']);
      expect(f.penalties.overlap).to.be.greaterThan(0);
    });
    it('score is bounded, deterministic and reflects the penalties', () => {
      const clean = assessPortfolioFit(base());
      const worse = assessPortfolioFit(base({ candidate: { instrument: 'BTC-USDT', side: 'buy', notional: '3000' }, returns: { 'BTC-USDT': wave, 'ETH-USDT': wave } }));
      expect(clean.score).to.be.within(0, 100);
      expect(worse.score).to.be.below(clean.score);
      expect(assessPortfolioFit(base())).to.deep.equal(clean);
    });
    it('rejects non-positive equity', () => {
      expect(() => assessPortfolioFit(base({ equity: '0' }))).to.throw(/equity/);
    });
  });

  it('feeds the scorecard: a concentrated candidate is REJECTED by the concentration gate', () => {
    const i = goodInput();
    i.portfolioFit = assessPortfolioFit(base({ candidate: { instrument: 'BTC-USDT', side: 'buy', notional: '5000' } }));
    const d = decide(i, { now: new Date(NOW) });
    expect(d.decision).to.equal('REJECT');
    expect(d.failed_gates).to.include('concentration');
    expect(d.dimension_scores.portfolio_fit).to.equal(i.portfolioFit.score);
  });
});
