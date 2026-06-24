import type { ReactNode } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@satelink/ui';
import styles from './LegacyDataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  mono?: boolean;
  muted?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  /** null = loading. */
  rows: T[] | null;
  getRowKey: (row: T, index: number) => string;
  error?: string | null;
  emptyLabel?: string;
  emptyMessage?: string;
  emptyNote?: string;
  /** Row key (per getRowKey) to highlight with an amber accent (e.g. the #1 lead). */
  accentRowKey?: string;
}

/** Typed table with built-in loading / error / empty states. */
export function LegacyDataTable<T>({
  columns,
  rows,
  getRowKey,
  error,
  emptyLabel = 'No data',
  emptyMessage,
  emptyNote,
  accentRowKey,
}: DataTableProps<T>): JSX.Element {
  if (rows === null && !error) return <LoadingState variant="rows" />;
  if (error) return <ErrorState title="Error loading data" description={error} />;
  if (rows !== null && rows.length === 0) return <EmptyState title={emptyLabel} description={emptyMessage || emptyNote} />;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={styles.th}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(rows ?? []).map((row, i) => {
          const rowKey = getRowKey(row, i);
          const isAccent = rowKey === accentRowKey;
          return (
            <tr
              key={rowKey}
              className={isAccent ? `${styles.tr} ${styles.trAccent}` : styles.tr}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${styles.td} ${c.mono ? styles.mono : ''} ${c.muted ? styles.muted : ''}`}
                >
                  {c.render ? c.render(row) : (row as any)[c.key]}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
