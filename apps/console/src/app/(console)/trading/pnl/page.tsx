import type { Metadata } from "next";
import { Badge, Empty, PageHeader, Panel, Table } from "@/components/ui";
import { ApiState, ModeBadge, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "P&L" };

type Snapshot = { id: string; mode: string; takenAt: string; marksComplete: boolean; unrealizedPnlMinor: string | null };

export default async function PnlPage() {
  requireAgentIa();
  const r = await tradingGet<Snapshot[]>("/portfolio/snapshots?limit=50");
  return (
    <>
      <PageHeader title="P&L" lede="Results recorded from fills and prices at the time. Not a forecast." />
      <Panel title="Snapshots">
        {!r.ok ? <ApiState status={r.status} code={r.code} what="P&L snapshots" /> : r.data.length === 0 ? <Empty title="No snapshots yet" body="A snapshot is recorded after positions change." /> : (
          <Table head={["Taken", "Mode", "Prices complete?"]}>
            {r.data.map((s) => (
              <tr key={s.id}><td>{new Date(s.takenAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</td><td><ModeBadge mode={s.mode} /></td>
                <td>{s.marksComplete ? <Badge tone="good">yes</Badge> : <Badge tone="warn">no — unrealised result not shown</Badge>}</td></tr>
            ))}
          </Table>
        )}
      </Panel>
      <TradingDisclosure />
    </>
  );
}
