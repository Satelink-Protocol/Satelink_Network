"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  /** Stable key, also used as React key for the cell. */
  key: string;
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
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
  /** Skeleton row count while loading. */
  loadingRows?: number;
  /** Error message — renders the error treatment instead of rows. */
  error?: string | null;
  /** Shown when there are zero rows (and not loading). */
  empty?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Enable client-side pagination when rows exceed this size. */
  pageSize?: number;
  /** Constrain height; the header row sticks while the body scrolls. */
  maxHeight?: number;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
}

/**
 * Canonical table: sticky header, sortable columns (when a column provides
 * `sortValue`), row hover, pagination, shape-matched skeleton rows, and
 * honest empty/error states. Callers never hand-roll `rows.length === 0`.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingRows = 5,
  error,
  empty,
  emptyTitle = "No data yet",
  emptyDescription,
  pageSize,
  maxHeight,
  onRowClick,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = React.useState(0);

  const alignClass = (align?: "left" | "right" | "center") =>
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";

  const data = React.useMemo(() => {
    const base = rows ?? [];
    if (!sort) return base;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return base;
    const sv = col.sortValue;
    return [...base].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(data.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = pageSize
    ? data.slice(safePage * pageSize, (safePage + 1) * pageSize)
    : data;

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === "asc"
          ? { key, dir: "desc" }
          : null
        : { key, dir: "asc" }
    );
  };

  if (error && !loading) {
    return (
      <EmptyState
        tone="error"
        title="Failed to load"
        description={error}
        className={className}
      />
    );
  }

  if (!loading && data.length === 0) {
    return (
      <>
        {empty ?? (
          <EmptyState title={emptyTitle} description={emptyDescription} className={className} />
        )}
      </>
    );
  }

  const headerCells = columns.map((col) => {
    const sortable = !!col.sortValue;
    const active = sort?.key === col.key;
    const SortIcon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <TableHead
        key={col.key}
        aria-sort={
          active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
        }
        className={cn(
          "bg-card text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
          alignClass(col.align),
          col.headerClassName
        )}
      >
        {sortable ? (
          <button
            type="button"
            onClick={() => toggleSort(col.key)}
            className={cn(
              "inline-flex items-center gap-1 transition-tokens hover:text-foreground",
              active && "text-foreground"
            )}
          >
            {col.header}
            <SortIcon className={cn("size-3", !active && "opacity-40")} />
          </button>
        ) : (
          col.header
        )}
      </TableHead>
    );
  });

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn(maxHeight != null && "overflow-y-auto")}
        style={maxHeight != null ? { maxHeight } : undefined}
      >
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">{headerCells}</TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: loadingRows }, (_, i) => (
                  <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                    {columns.map((col) => (
                      <TableCell key={col.key} className={alignClass(col.align)}>
                        <Skeleton className="h-4 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : pageRows.map((row, i) => {
                  const index = pageSize ? safePage * (pageSize ?? 0) + i : i;
                  return (
                    <TableRow
                      key={rowKey(row, index)}
                      onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onRowClick(row, index);
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        "transition-tokens hover:bg-muted/40",
                        onRowClick && "cursor-pointer"
                      )}
                    >
                      {columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={cn(alignClass(col.align), col.className)}
                        >
                          {col.cell(row, index)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      </div>

      {pageSize && data.length > pageSize && !loading ? (
        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
          <span className="numeric text-[11px] text-muted-foreground">
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, data.length)} of{" "}
            {data.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="numeric text-[11px] text-muted-foreground">
              {safePage + 1}/{pageCount}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
