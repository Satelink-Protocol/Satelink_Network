// M3 — derived trading intelligence: pure-computation tests (no I/O, offline).
import { expect } from 'chai';
import {
  annualizeFunding,
  fundingRateHeatmap,
  openInterestShifts,
  liquidationClusters,
  marketMicrostructure,
  METRICS,
} from '../src/intelligence/compute.js';

describe('intelligence/compute (pure derived metrics)', () => {
  describe('annualizeFunding', () => {
    it('annualizes an 8h funding rate by 1095 intervals/yr', () => {
      // 0.0001 per 8h → 0.0001 * (8760/8) = 0.1095
      expect(annualizeFunding(0.0001, 8)).to.be.closeTo(0.1095, 1e-9);
    });
    it('returns null on garbage input (never fabricates)', () => {
      expect(annualizeFunding('x', 8)).to.equal(null);
      expect(annualizeFunding(0.0001, 0)).to.equal(null);
      expect(annualizeFunding(NaN, 8)).to.equal(null);
    });
  });

  describe('fundingRateHeatmap', () => {
    it('computes per-symbol mean APR and cross-exchange divergence, hottest first', () => {
      const out = fundingRateHeatmap([
        { symbol: 'BTCUSDT', exchange: 'binance', fundingRate: 0.0001 },
        { symbol: 'BTCUSDT', exchange: 'bybit', fundingRate: 0.0003 },
        { symbol: 'ETHUSDT', exchange: 'binance', fundingRate: 0.00005 },
        { symbol: 'ETHUSDT', exchange: 'bybit', fundingRate: 0.00006 },
      ]);
      expect(out.metric).to.equal('funding-rate-heatmap');
      expect(out.universe).to.equal(2);
      // BTC divergence (0.0003 vs 0.0001) >> ETH → BTC first.
      expect(out.symbols[0].symbol).to.equal('BTCUSDT');
      const btc = out.symbols[0];
      // divergence = annualize(0.0003) - annualize(0.0001) = 1095*(0.0002)=0.219
      expect(btc.divergence_apr).to.be.closeTo(0.219, 1e-6);
      // Harvest: short the higher-funding exchange (bybit), long the lower (binance).
      expect(btc.short_exchange).to.equal('bybit');
      expect(btc.long_exchange).to.equal('binance');
      expect(btc.exchanges).to.equal(2);
    });
    it('single-exchange symbol has zero divergence, not a fabricated spread', () => {
      const out = fundingRateHeatmap([{ symbol: 'BTCUSDT', exchange: 'binance', fundingRate: 0.0001 }]);
      expect(out.symbols[0].divergence_apr).to.equal(0);
      expect(out.symbols[0].short_exchange).to.equal(null);
    });
    it('drops malformed rows, empty input → empty universe', () => {
      expect(fundingRateHeatmap([]).universe).to.equal(0);
      expect(fundingRateHeatmap([{ symbol: 'X' }, null, { fundingRate: 0.1 }]).universe).to.equal(0);
    });
  });

  describe('openInterestShifts', () => {
    it('computes absolute + percent change vs the prior snapshot', () => {
      const cur = [{ symbol: 'BTCUSDT', exchange: 'binance', openInterestUsd: 1200 }];
      const prev = [{ symbol: 'BTCUSDT', exchange: 'binance', openInterestUsd: 1000 }];
      const out = openInterestShifts(cur, prev);
      expect(out.has_baseline).to.equal(true);
      expect(out.symbols[0].change_usd).to.equal(200);
      expect(out.symbols[0].change_pct).to.be.closeTo(0.2, 1e-9);
    });
    it('no baseline → change is null (honest), not zero', () => {
      const out = openInterestShifts([{ symbol: 'BTCUSDT', openInterestUsd: 1200 }], []);
      expect(out.has_baseline).to.equal(false);
      expect(out.symbols[0].change_usd).to.equal(null);
      expect(out.symbols[0].change_pct).to.equal(null);
      expect(out.symbols[0].open_interest_usd).to.equal(1200);
    });
    it('aggregates across exchanges per symbol', () => {
      const out = openInterestShifts(
        [
          { symbol: 'BTCUSDT', exchange: 'binance', openInterestUsd: 700 },
          { symbol: 'BTCUSDT', exchange: 'bybit', openInterestUsd: 300 },
        ],
        [{ symbol: 'BTCUSDT', openInterestUsd: 500 }]
      );
      expect(out.symbols[0].open_interest_usd).to.equal(1000);
      expect(out.symbols[0].change_usd).to.equal(500);
    });
  });

  describe('liquidationClusters (model proxy — labeled)', () => {
    it('places long/short liq bands around mark and labels itself a model', () => {
      const out = liquidationClusters([{ symbol: 'BTCUSDT', markPrice: 100, fundingRate: 0.001 }], [10]);
      expect(out.model).to.equal('leverage-band-proxy');
      expect(out.disclaimer).to.match(/NOT measured/i);
      const c = out.symbols[0].clusters;
      const longLiq = c.find((x) => x.side === 'long_liquidation' && x.leverage === 10);
      const shortLiq = c.find((x) => x.side === 'short_liquidation' && x.leverage === 10);
      expect(longLiq.price).to.equal(90); // 100*(1-1/10)
      expect(shortLiq.price).to.equal(110); // 100*(1+1/10)
      // Positive funding ⇒ crowded longs ⇒ weight on long-liquidation side.
      expect(longLiq.crowding_weight).to.be.greaterThan(0);
      expect(shortLiq.crowding_weight).to.equal(0);
    });
    it('skips non-positive / malformed mark prices', () => {
      expect(liquidationClusters([{ symbol: 'X', markPrice: 0 }]).universe).to.equal(0);
    });
  });

  describe('marketMicrostructure', () => {
    it('computes mid, spread bps, and depth imbalance', () => {
      const out = marketMicrostructure([
        {
          symbol: 'BTCUSDT',
          exchange: 'binance',
          bids: [['100', '2']], // 100*2 = 200 depth
          asks: [['101', '1']], // 101*1 = 101 depth
        },
      ]);
      const s = out.symbols[0];
      expect(s.mid).to.equal(100.5);
      expect(s.spread).to.equal(1);
      expect(s.spread_bps).to.be.closeTo((1 / 100.5) * 10000, 1e-2);
      // bid-heavy → positive imbalance
      expect(s.depth_imbalance).to.be.greaterThan(0);
    });
    it('rejects crossed / empty books (never fabricates a mid)', () => {
      expect(marketMicrostructure([{ symbol: 'X', bids: [['101', '1']], asks: [['100', '1']] }]).universe).to.equal(0);
      expect(marketMicrostructure([{ symbol: 'X', bids: [], asks: [['100', '1']] }]).universe).to.equal(0);
    });
  });

  describe('METRICS registry', () => {
    it('prices every metric and marks the liquidation proxy as derived-model', () => {
      expect(Object.keys(METRICS)).to.have.members([
        'funding-rate-heatmap',
        'open-interest-shifts',
        'liquidation-clusters',
        'market-microstructure',
      ]);
      for (const m of Object.values(METRICS)) expect(m.price_usdt).to.equal(0.01);
      expect(METRICS['liquidation-clusters'].kind).to.equal('derived-model');
    });
  });
});
