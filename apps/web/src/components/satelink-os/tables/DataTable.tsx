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
  /** Row key (per getRowKey) to highlight with an amber accent (e.g. the #1 lead). */
  accentRowKey?: string;
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
  accentRowKey,
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
            {(rows ?? []).map((row, i) => {
              const rowKey = getRowKey(row, i);
              return (
              <tr
                key={rowKey}
                className={styles.tr}
                data-accent={accentRowKey != null && rowKey === accentRowKey ? '1' : undefined}
              >
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
              );
            })}
          </tbody>
        </table>
      )}
    </DataState>
  );
}
