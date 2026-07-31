import { describe, it, expect } from 'vitest';
import { ok, err } from './result.js';
import type { Result } from './result.js';

describe('Result', () => {
  describe('ok()', () => {
    it('creates an Ok result', () => {
      const r = ok(42);
      expect(r.ok).toBe(true);
      expect(r.isOk).toBe(true);
      expect(r.isErr).toBe(false);
      expect(r.value).toBe(42);
      expect(r.error).toBeUndefined();
    });

    it('works with string values', () => {
      const r = ok('hello');
      expect(r.value).toBe('hello');
    });

    it('works with complex objects', () => {
      const obj = { a: 1, b: [2, 3] };
      const r = ok(obj);
      expect(r.value).toBe(obj);
    });

    it('works with null value', () => {
      const r = ok(null);
      expect(r.isOk).toBe(true);
      expect(r.value).toBeNull();
    });

    it('works with undefined value', () => {
      const r = ok(undefined);
      expect(r.isOk).toBe(true);
      expect(r.value).toBeUndefined();
    });
  });

  describe('err()', () => {
    it('creates an Err result', () => {
      const r = err('fail');
      expect(r.ok).toBe(false);
      expect(r.isOk).toBe(false);
      expect(r.isErr).toBe(true);
      expect(r.error).toBe('fail');
      expect(r.value).toBeUndefined();
    });

    it('works with error objects', () => {
      const e = new Error('boom');
      const r = err(e);
      expect(r.error).toBe(e);
    });
  });

  describe('map()', () => {
    it('transforms Ok value', () => {
      const r = ok(10).map((x) => x * 2);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value).toBe(20);
      }
    });

    it('skips Err value', () => {
      const r: Result<number, string> = err('fail');
      const mapped = r.map((x) => x * 2);
      expect(mapped.isErr).toBe(true);
      if (mapped.isErr) {
        expect(mapped.error).toBe('fail');
      }
    });
  });

  describe('mapErr()', () => {
    it('skips Ok value', () => {
      const r = ok(10);
      const mapped = r.mapErr((e) => `wrapped: ${String(e)}`);
      expect(mapped.isOk).toBe(true);
      if (mapped.isOk) {
        expect(mapped.value).toBe(10);
      }
    });

    it('transforms Err error', () => {
      const r: Result<number, string> = err('fail');
      const mapped = r.mapErr((e) => `wrapped: ${e}`);
      expect(mapped.isErr).toBe(true);
      if (mapped.isErr) {
        expect(mapped.error).toBe('wrapped: fail');
      }
    });
  });

  describe('unwrapOr()', () => {
    it('returns value for Ok', () => {
      const r = ok(42);
      expect(r.unwrapOr(0)).toBe(42);
    });

    it('returns fallback for Err', () => {
      const r: Result<number, string> = err('fail');
      expect(r.unwrapOr(0)).toBe(0);
    });
  });

  describe('type narrowing', () => {
    it('narrows via ok discriminant', () => {
      const r: Result<number, string> = ok(42);
      if (r.ok) {
        // TypeScript narrows to Ok<number>
        const _v: number = r.value;
        expect(_v).toBe(42);
      }
    });

    it('narrows via isOk', () => {
      const r: Result<number, string> = ok(42);
      if (r.isOk) {
        const _v: number = r.value;
        expect(_v).toBe(42);
      }
    });

    it('narrows via isErr', () => {
      const r: Result<number, string> = err('nope');
      if (r.isErr) {
        const _e: string = r.error;
        expect(_e).toBe('nope');
      }
    });
  });
});
