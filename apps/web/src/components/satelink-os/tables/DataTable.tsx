import type { ReactNode } from 'react';

import { DataState } from '../shared/DataState';
import styles from './DataTable.module.css';

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
}

/** Typed table with built-in loading / error / empty states. */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  error,
  emptyLabel = 'No data',
  emptyMessage,
  emptyNote,
}: DataTableProps<T>): JSX.Element {
  return (
    <DataState
      loading={rows === null}
      error={error ?? null}
      empty={rows !== null && rows.length === 0}
      emptyLabel={emptyLabel}
      emptyMessage={emptyMessage}
      emptyNote={emptyNote}
    >
      {() => (
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
            {(rows ?? []).map((row, i) => (
              <tr key={getRowKey(row, i)} className={styles.tr}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={styles.td}
                    data-mono={c.mono ? '1' : undefined}
                    data-muted={c.muted ? '1' : undefined}
                  >
                    {c.render
                      ? c.render(row)
                      : String((row as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DataState>
  );
}
