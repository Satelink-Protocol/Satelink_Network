/**
 * Result<T, E> — Discriminated union for expected failures.
 *
 * Domain code uses Result instead of exceptions for recoverable errors such as
 * currency mismatch or invalid input. This keeps the domain pure and composable.
 *
 * @example
 *   const parsed = Money.fromDecimalString('10.50', USDC);
 *   if (parsed.isOk) {
 *     console.log(parsed.value.toDecimalString());
 *   } else {
 *     console.error(parsed.error);
 *   }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Ok<T> {
  readonly ok: true;
  readonly isOk: true;
  readonly isErr: false;
  readonly value: T;
  readonly error?: undefined;

  map<U>(fn: (value: T) => U): Result<U, never>;
  mapErr<F>(fn: (error: never) => F): Result<T, F>;
  unwrapOr(fallback: T): T;
}

export interface Err<E> {
  readonly ok: false;
  readonly isOk: false;
  readonly isErr: true;
  readonly value?: undefined;
  readonly error: E;

  map<U>(fn: (value: never) => U): Result<U, E>;
  mapErr<F>(fn: (error: E) => F): Result<never, F>;
  unwrapOr<T>(fallback: T): T;
}

export type Result<T, E> = Ok<T> | Err<E>;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

class OkImpl<T> implements Ok<T> {
  readonly ok = true as const;
  readonly isOk = true as const;
  readonly isErr = false as const;
  readonly error = undefined;

  constructor(readonly value: T) {}

  map<U>(fn: (value: T) => U): Result<U, never> {
    return new OkImpl(fn(this.value));
  }

  mapErr<F>(_fn: (error: never) => F): Result<T, F> {
    return this as unknown as Result<T, F>;
  }

  unwrapOr(_fallback: T): T {
    return this.value;
  }
}

class ErrImpl<E> implements Err<E> {
  readonly ok = false as const;
  readonly isOk = false as const;
  readonly isErr = true as const;
  readonly value = undefined;

  constructor(readonly error: E) {}

  map<U>(_fn: (value: never) => U): Result<U, E> {
    return this as unknown as Result<U, E>;
  }

  mapErr<F>(fn: (error: E) => F): Result<never, F> {
    return new ErrImpl(fn(this.error));
  }

  unwrapOr<T>(fallback: T): T {
    return fallback;
  }
}

/** Create a successful Result containing `value`. */
export function ok<T>(value: T): Ok<T> {
  return new OkImpl(value);
}

/** Create a failed Result containing `error`. */
export function err<E>(error: E): Err<E> {
  return new ErrImpl(error);
}
