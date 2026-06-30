import * as React from "react";

import { cn } from "../lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { LoadingState } from "./loading-state";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  /** Stable key, also used as React key for the cell. */
  key: string;
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined | null;
  /** Stable row key. */
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  /** Shown when there are zero rows (and not loading). */
  empty?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Canonical table. Owns its own loading + empty states so callers never
 * hand-roll "if rows.length === 0" branches. Pair with <AsyncBoundary> for
 * the error state.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  emptyTitle = "No records found",
  emptyDescription,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return <LoadingState variant="rows" count={5} />;
  }

  const data = rows ?? [];
  if (data.length === 0) {
    return (
      empty ?? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      )
    );
  }

  const alignClass = (align?: "left" | "right" | "center") =>
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";

  return (
    <div className="w-full overflow-auto rounded-md border border-border">
      <Table className={cn("w-full", className)}>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border bg-muted/20">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground py-2 px-3 whitespace-nowrap",
                  alignClass(col.align),
                  col.headerClassName
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow
              key={rowKey(row, i)}
              className="border-b border-border/40 hover:bg-primary/[0.04] transition-colors"
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={cn(
                    "py-2 px-3 text-xs tabular-nums",
                    alignClass(col.align),
                    col.className
                  )}
                >
                  {col.cell(row, i)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
