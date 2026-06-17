import type { ReactNode } from 'react';

import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';
import styles from './DataState.module.css';

export interface DataStateProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyLabel?: string;
  emptyNote?: string;
  loadingLabel?: string;
  /** Rendered only when not loading/error/empty. */
  children: () => ReactNode;
}

/**
 * The SigNoz `DataStateRenderer` four-state contract, adapted:
 *   loading → error → empty → data.
 * Guarantees a real backend state is always shown — never simulated data.
 */
export function DataState({
  loading,
  error,
  empty,
  emptyLabel = 'No data',
  emptyNote,
  loadingLabel,
  children,
}: DataStateProps): JSX.Element {
  if (loading) return <Spinner label={loadingLabel} />;
  if (error) return <div className={styles.error}>Error: {error}</div>;
  if (empty) return <EmptyState variant="block" label={emptyLabel} note={emptyNote} />;
  return <>{children()}</>;
}
