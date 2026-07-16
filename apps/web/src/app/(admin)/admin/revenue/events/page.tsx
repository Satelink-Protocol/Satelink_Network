"use client";

import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "@satelink/ui";
import { DataScopeBadge } from "../../_components/DataScope";

interface RevenueEvent {
  id: number | string;
  amount_usdt: string | number;
  is_test_data?: boolean;
  source?: string | null;
  created_at: number | string;
}

const columns: DataTableColumn<RevenueEvent>[] = [
  { key: "id", header: "ID", cell: (r) => <span className="font-mono text-xs">{r.id}</span> },
  {
    key: "source",
    header: "Source",
    cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.source ?? "—"}</span>,
  },
  {
    key: "amount_usdt",
    header: "Amount",
    cell: (r) => <span className="font-mono text-emerald-400">${Number(r.amount_usdt).toFixed(4)}</span>,
    align: "right",
  },
  {
    key: "created_at",
    header: "Time",
    // Observer endpoint returns created_at as epoch seconds; guard both shapes.
    cell: (r) => {
      const n = Number(r.created_at);
      const d = Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date(r.created_at);
      return d.toLocaleString();
    },
    align: "right",
  },
];

export default function AdminRevenueEventsPage() {
  const [events, setEvents] = useState<RevenueEvent[] | null>(null);
  const [testHidden, setTestHidden] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Was fetch("/api/revenue/events") — the public endpoint returns every row
    // with no is_test_data awareness, so founder/test settlements appeared as
    // real revenue events. /admin/revenue/events tags each row; we drop the
    // test rows here and surface the count that was hidden.
    fetch("/api/admin-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "revenue/events?limit=100", method: "GET" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok || !Array.isArray(data.events)) {
          setEvents([]);
          return;
        }
        const all: RevenueEvent[] = data.events;
        const real = all.filter((e) => !e.is_test_data);
        setTestHidden(all.length - real.length);
        setEvents(real);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <DataScopeBadge included={false} testCount={testHidden} />
      </div>
      <DataTable
        columns={columns}
        rows={events}
        rowKey={(r) => String(r.id)}
        loading={loading}
        emptyTitle="No real revenue events"
        emptyDescription="No externally-billed revenue events have been recorded yet (founder/test events are excluded)."
      />
    </div>
  );
}
