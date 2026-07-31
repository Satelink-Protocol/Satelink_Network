import { describe, it, expect } from 'vitest';
import { Currency, UnknownCurrencyError, USDC, USDT, ETH, POL } from './currency.js';

describe('Currency', () => {
  describe('registry', () => {
    it('USDC has code USDC and 6 decimals', () => {
      expect(USDC.code).toBe('USDC');
      expect(USDC.decimals).toBe(6);
      expect(USDC.minorMultiplier).toBe(10n ** 6n);
    });

    it('USDT has code USDT and 6 decimals', () => {
      expect(USDT.code).toBe('USDT');
      expect(USDT.decimals).toBe(6);
      expect(USDT.minorMultiplier).toBe(10n ** 6n);
    });

    it('ETH has code ETH and 18 decimals', () => {
      expect(ETH.code).toBe('ETH');
      expect(ETH.decimals).toBe(18);
      expect(ETH.minorMultiplier).toBe(10n ** 18n);
    });

    it('POL has code POL and 18 decimals', () => {
      expect(POL.code).toBe('POL');
      expect(POL.decimals).toBe(18);
      expect(POL.minorMultiplier).toBe(10n ** 18n);
    });

    it('ALL contains exactly 4 currencies', () => {
      expect(Currency.ALL).toHaveLength(4);
      expect(Currency.ALL).toContain(USDC);
      expect(Currency.ALL).toContain(USDT);
      expect(Currency.ALL).toContain(ETH);
      expect(Currency.ALL).toContain(POL);
    });

    it('ALL is frozen', () => {
      expect(Object.isFrozen(Currency.ALL)).toBe(true);
    });

    it('currency instances are frozen', () => {
      expect(Object.isFrozen(USDC)).toBe(true);
      expect(Object.isFrozen(ETH)).toBe(true);
    });
  });

  describe('Currency.of()', () => {
    it('resolves USDC', () => {
      const r = Currency.of('USDC');
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value).toBe(USDC);
      }
    });

    it('resolves USDT', () => {
      const r = Currency.of('USDT');
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value).toBe(USDT);
      }
    });

    it('resolves ETH', () => {
      const r = Currency.of('ETH');
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value).toBe(ETH);
      }
    });

    it('resolves POL', () => {
      const r = Currency.of('POL');
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value).toBe(POL);
      }
    });

    it('rejects unknown currency with UnknownCurrencyError', () => {
      const r = Currency.of('DOGE');
      expect(r.isErr).toBe(true);
      if (r.isErr) {
        expect(r.error).toBeInstanceOf(UnknownCurrencyError);
        expect(r.error.tag).toBe('UnknownCurrencyError');
        expect(r.error.code).toBe('DOGE');
      }
    });

    it('rejects empty string', () => {
      const r = Currency.of('');
      expect(r.isErr).toBe(true);
    });

    it('is case-sensitive', () => {
      const r = Currency.of('usdc');
      expect(r.isErr).toBe(true);
    });
  });

  describe('equals()', () => {
    it('same currency is equal', () => {
      expect(USDC.equals(USDC)).toBe(true);
    });

    it('different currency is not equal', () => {
      expect(USDC.equals(USDT)).toBe(false);
    });

    it('same decimals but different code is not equal', () => {
      expect(USDC.equals(USDT)).toBe(false);
      expect(ETH.equals(POL)).toBe(false);
    });

    it('same code check — USDC equals itself from registry', () => {
      const r = Currency.of('USDC');
      if (r.isOk) {
        expect(r.value.equals(USDC)).toBe(true);
      }
    });
  });

  describe('toString()', () => {
    it('formats as code/decimals', () => {
      expect(USDC.toString()).toBe('USDC/6');
      expect(ETH.toString()).toBe('ETH/18');
    });
  });

  describe('UnknownCurrencyError', () => {
    it('has descriptive toString', () => {
      const e = new UnknownCurrencyError('DOGE');
      expect(e.toString()).toContain('DOGE');
      expect(e.toString()).toContain('not a supported currency');
    });
  });
});
