"use client";

/**
 * /design — living render-check for every @satelink/ui component in all
 * states (default / loading / empty / error). Phase 1 acceptance surface:
 * if it isn't correct here, it isn't correct anywhere.
 *
 * All demo values are clearly labeled sample data — this page never claims
 * to show production metrics.
 */

import { useState } from "react";
import { Activity, DollarSign, KeyRound, Server } from "lucide-react";
import {
  AlertBand,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyField,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  KPICard,
  LoadingState,
  Modal,
  Skeleton,
  StatusBadge,
  StatusPill,
  TimeseriesPanel,
  type DataTableColumn,
} from "@satelink/ui";

interface DemoRow {
  id: string;
  wallet: string;
  amount: number;
  status: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", wallet: "0x5cbda3a1c0f1b28fecea1d919785321e88f9fa97", amount: 5.0, status: "confirmed" },
  { id: "2", wallet: "0x966e1ae22996545015b1414b35234b10719d7ad4", amount: 0.5, status: "confirmed" },
  { id: "3", wallet: "0x0000000000000000000000000000000000000dEaD", amount: 0.1, status: "pending" },
];

const DEMO_COLS: DataTableColumn<DemoRow>[] = [
  {
    key: "wallet",
    header: "Wallet",
    cell: (r) => <span className="font-mono text-xs">{r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}</span>,
    sortValue: (r) => r.wallet,
  },
  {
    key: "amount",
    header: "Amount (USDT)",
    align: "right",
    cell: (r) => <span className="font-mono">${r.amount.toFixed(2)}</span>,
    sortValue: (r) => r.amount,
  },
  { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
];

const now = Date.now();
const DEMO_SERIES = Array.from({ length: 24 }, (_, i) => ({
  ts: now - (23 - i) * 3600_000,
  requests: [420, 380, 350, 300, 280, 310, 460, 620, 810, 900, 870, 940, 1010, 980, 890, 920, 1100, 1180, 1050, 940, 860, 700, 560, 480][i],
}));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{children}</p>;
}

export default function DesignPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="satelink-os min-h-screen">
      <div className="mx-auto max-w-6xl space-y-12 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">@satelink/ui — design system</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every component in every state. Sample data only — nothing here is a production metric.
          </p>
        </header>

        <Section title="KPICard">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div><StateLabel>default</StateLabel><KPICard label="Revenue (sample)" icon={DollarSign} value="$0.00015" caption="$0.00012 external · $0.00003 internal" /></div>
            <div><StateLabel>with trend</StateLabel><KPICard label="Requests (sample)" icon={Activity} value="64,016" caption="since UTC midnight" trendValue={4.2} /></div>
            <div><StateLabel>loading</StateLabel><KPICard label="Loading" value="" loading /></div>
            <div><StateLabel>empty / no backend</StateLabel><KPICard label="p95 latency" value="—" caption="No telemetry yet — data appears after first metered call" /></div>
          </div>
        </Section>

        <Section title="StatusBadge / StatusPill / Badge">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="healthy" state="healthy" label="Operational" />
            <StatusPill status="degraded" state="degraded" label="Degraded" />
            <StatusPill status="critical" state="critical" label="Critical" />
            <StatusPill status="unknown" state="unknown" label="Unknown" />
            <StatusBadge status="active" />
            <StatusBadge status="dry_run" />
            <Badge variant="outline">outline</Badge>
            <Badge variant="destructive">destructive</Badge>
          </div>
        </Section>

        <Section title="AlertBand">
          <StateLabel>severities + unblock conditions</StateLabel>
          <AlertBand
            alerts={[
              { code: "SIGNER_UNFUNDED", message: "Signer unfunded — fund 0x988f… with POL to release 1,954 batches (sample)", severity: "critical" },
              { code: "SETTLEMENT_DRY_RUN", message: "Settlement in DRY_RUN — clears at real external revenue > $0.50 (sample)", severity: "warning" },
              { code: "INFO", message: "Informational alert (sample)", severity: "info" },
              { code: "RESOLVED", message: "Resolved alert (sample)", severity: "resolved" },
            ]}
          />
          <StateLabel>empty</StateLabel>
          <AlertBand alerts={[]} />
        </Section>

        <Section title="DataTable">
          <div className="grid gap-6 lg:grid-cols-2">
            <div><StateLabel>default (sortable, mono machine values)</StateLabel>
              <DataTable columns={DEMO_COLS} rows={DEMO_ROWS} rowKey={(r) => r.id} /></div>
            <div><StateLabel>loading</StateLabel>
              <DataTable columns={DEMO_COLS} rows={null} loading rowKey={(r: DemoRow) => r.id} /></div>
            <div><StateLabel>empty</StateLabel>
              <DataTable columns={DEMO_COLS} rows={[]} rowKey={(r: DemoRow) => r.id} emptyTitle="No deposits yet" emptyDescription="Deposits appear within ~30s of on-chain confirmation." /></div>
            <div><StateLabel>error</StateLabel>
              <DataTable columns={DEMO_COLS} rows={null} error="fetch failed: 502" rowKey={(r: DemoRow) => r.id} /></div>
          </div>
        </Section>

        <Section title="TimeseriesPanel">
          <div className="grid gap-6 lg:grid-cols-2">
            <div><StateLabel>default (sample series)</StateLabel>
              <TimeseriesPanel title="Gateway Traffic (sample)" subtitle="24h sample series" data={DEMO_SERIES} series={[{ key: "requests", label: "Requests", type: "area" }]} /></div>
            <div><StateLabel>empty — honest gap, no interpolation</StateLabel>
              <TimeseriesPanel title="Gateway Traffic" data={[]} series={[{ key: "requests", label: "Requests", type: "area" }]} emptyHint="No request-history endpoint yet." showLegend={false} /></div>
            <div><StateLabel>loading</StateLabel>
              <TimeseriesPanel title="Loading" data={[]} series={[{ key: "requests", label: "Requests" }]} loading /></div>
            <div><StateLabel>error</StateLabel>
              <TimeseriesPanel title="Errored" data={[]} series={[{ key: "requests", label: "Requests" }]} error="upstream 500" /></div>
          </div>
        </Section>

        <Section title="Modal">
          <StateLabel>opaque surface · blurred backdrop · right-aligned actions (8px gap)</StateLabel>
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Modal
            open={modalOpen}
            onOpenChange={setModalOpen}
            title="Create API Key"
            description="Generate a new free-tier key (sample dialog)."
            footer={
              <>
                <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button onClick={() => setModalOpen(false)}>Create Key</Button>
              </>
            }
          >
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Label</label>
              <Input placeholder="My API Key" />
            </div>
          </Modal>
        </Section>

        <Section title="CopyField">
          <div className="grid gap-4 md:grid-cols-2">
            <CopyField label="Vault address (truncated)" value="0x577D3716d6Ad5b676d230f5409deF9838FABaCEF" />
            <CopyField label="API key (masked)" value="sk_free_61c987ad2276b566dbf139c22e74d3a434f8d1d947735677" mask />
          </div>
        </Section>

        <Section title="Empty / Loading / Error states">
          <div className="grid gap-4 md:grid-cols-3">
            <EmptyState icon={KeyRound} title="No API keys yet" description="Create your first key — one click, free tier included." action={<Button size="sm">Create key</Button>} />
            <LoadingState variant="rows" count={4} />
            <ErrorState title="Fetch failed" description="GET /admin/executive/summary returned 502." />
          </div>
        </Section>

        <Section title="Primitives">
          <Card>
            <CardHeader><CardTitle>Card + form primitives</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button disabled>Disabled</Button>
              <Input placeholder="Input" className="max-w-48" />
              <Skeleton className="h-8 w-32" />
              <span className="flex items-center gap-2 text-sm text-muted-foreground"><Server className="size-4" /> icons via lucide</span>
            </CardContent>
          </Card>
        </Section>
      </div>
    </div>
  );
}
