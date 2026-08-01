/**
 * Shared repository failure types for the M4 aggregates.
 */

export interface RepositoryError {
  readonly tag: 'RepositoryError';
  readonly message: string;
  readonly cause?: unknown;
}

/** Raised when an optimistic-locking write loses the compare-and-set race. */
export interface StaleVersionError {
  readonly tag: 'StaleVersionError';
  readonly id: string;
  readonly expected: number;
}

export function repositoryError(message: string, cause?: unknown): RepositoryError {
  return { tag: 'RepositoryError', message, cause };
}

export function staleVersionError(id: string, expected: number): StaleVersionError {
  return { tag: 'StaleVersionError', id, expected };
}

export type WriteError = RepositoryError | StaleVersionError;
