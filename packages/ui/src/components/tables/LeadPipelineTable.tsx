import React from 'react';
import { LegacyDataTable as DataTable, type Column } from './LegacyDataTable';
import { StatusBadge } from '../status-badge';
import { SparkArea } from '../charts/SparkArea';
import { HorizontalMetricBar } from '../charts/HorizontalMetricBar';
import { Button } from '../ui/button';

export interface Developer {
  ip: string;
  isp?: string;
  country?: string;
  classification?: string;
  avg_daily_calls?: number;
  days_active?: number;
  score?: number;
  status: string;
}

export interface LeadPipelineTableProps {
  devs: Developer[] | null;
  topLeadIp?: string;
  maxCalls: number;
  busy: Record<string, boolean>;
  devErr?: string | null;
  advance: (ip: string, nextStage: string) => void;
}

const NEXT_STAGE: Record<string, string> = { identified: "contacted", contacted: "deposited", deposited: "paid" };
const STAGE_BTN: Record<string, string> = { contacted: "Mark Contacted", deposited: "Mark Deposited", paid: "Mark Paid" };

function getStatusBadgeVariant(status: string): "success" | "warning" | "destructive" | "neutral" | "default" {
  switch (status.toLowerCase()) {
    case "paid":
      return "success";
    case "contacted":
      return "warning";
    case "deposited":
      return "default";
    case "identified":
      return "neutral";
    default:
      return "neutral";
  }
}

const fmt = {
  num: (n: number | undefined) =>
    n == null || Number.isNaN(Number(n))
      ? "—"
      : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
      ? `${(n / 1e3).toFixed(1)}K`
      : String(n),
};

export function LeadPipelineTable({
  devs,
  topLeadIp,
  maxCalls,
  busy,
  devErr,
  advance,
}: LeadPipelineTableProps): JSX.Element {
  const columns: Column<Developer>[] = [
    {
      key: "ip",
      header: "IP",
      mono: true,
      render: (d) => (
        <>
          {d.ip}
          {d.ip === topLeadIp ? (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 5px",
                fontSize: 9,
                fontFamily: "JetBrains Mono",
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.4)",
                color: "#F59E0B",
                borderRadius: 2,
                letterSpacing: "0.08em",
              }}
            >
              #1
            </span>
          ) : null}
        </>
      ),
    },
    { key: "loc", header: "ISP / Country", render: (d) => [d.isp, d.country].filter(Boolean).join(" · ") || "—" },
    {
      key: "class",
      header: "Class",
      render: (d) => (
        <StatusBadge
          status={d.classification || "unknown"}
          variant={d.classification === "developer" ? "default" : "neutral"}
        />
      ),
    },
    {
      key: "calls",
      header: "Calls/day",
      render: (d) => (
        <HorizontalMetricBar
          value={d.avg_daily_calls || 0}
          max={maxCalls}
          color="var(--sat-success)"
          label={fmt.num(d.avg_daily_calls)}
        />
      ),
    },
    {
      key: "trend",
      header: "Trend",
      render: (d) => <SparkArea data={[d.avg_daily_calls || 0]} ariaLabel={`${d.ip} calls/day`} />,
    },
    { key: "days", header: "Days", mono: true, muted: true, render: (d) => String(d.days_active ?? 0) },
    {
      key: "score",
      header: "Score",
      render: (d) => {
        const score = d.score ?? 0;
        let color = "var(--sat-text-dim)";
        if (score > 70) color = "var(--sat-success)";
        else if (score > 30) color = "var(--sat-warn)";
        return <HorizontalMetricBar value={score} max={100} color={color} label={`${score}%`} />;
      },
    },
    {
      key: "status",
      header: "Stage",
      render: (d) => (
        <StatusBadge
          status={d.status}
          variant={getStatusBadgeVariant(d.status)}
        />
      ),
    },
    {
      key: "action",
      header: "",
      render: (d) => {
        const next = NEXT_STAGE[d.status];
        if (!next) return null;
        return (
          <Button
            size="sm"
            variant={getStatusBadgeVariant(next) === "success" ? "default" : "outline"}
            disabled={busy[`stage:${d.ip}`]}
            onClick={() => advance(d.ip, next)}
          >
            {busy[`stage:${d.ip}`] ? "Saving…" : STAGE_BTN[next]}
          </Button>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={devs}
      getRowKey={(d) => d.ip}
      accentRowKey={topLeadIp}
      error={devErr}
      emptyLabel="lead pipeline"
      emptyMessage="No leads match the active filters"
      emptyNote="adjust checkboxes in the filters pane"
    />
  );
}
