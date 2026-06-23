"use client";

import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "@satelink/ui";

interface RevenueEvent {
  id: number | string;
  amount_usdt: string | number;
  created_at: string;
}

const columns: DataTableColumn<RevenueEvent>[] = [
  { key: "id", header: "ID", cell: (r) => <span className="font-mono text-xs">{r.id}</span> },
  {
    key: "amount_usdt",
    header: "Amount",
    cell: (r) => <span className="font-mono text-emerald-400">${Number(r.amount_usdt).toFixed(4)}</span>,
    align: "right",
  },
  {
    key: "created_at",
    header: "Time",
    cell: (r) => new Date(r.created_at).toLocaleString(),
    align: "right",
  },
];

export default function AdminRevenueEventsPage() {
  const [events, setEvents] = useState<RevenueEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/revenue/events")
      .then((r) => r.json())
      .then((data) => setEvents(data?.ok ? data.events : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DataTable
      columns={columns}
      rows={events}
      rowKey={(r) => String(r.id)}
      loading={loading}
      emptyTitle="No revenue events"
      emptyDescription="No billed revenue events have been recorded yet."
    />
  );
}
