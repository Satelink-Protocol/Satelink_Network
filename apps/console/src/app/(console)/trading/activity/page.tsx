import type { Metadata } from "next";
import { Empty, PageHeader, Panel, Table } from "@/components/ui";
import { ApiState, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "Activity" };

type Stop = { scopeType: string; scopeId: string | null; reason: string; at?: string };

export default async function ActivityPage() {
  requireAgentIa();
  const stops = await tradingGet<Stop[]>("/kill-switch");
  return (
    <>
      <PageHeader title="Activity" lede="What happened, and why. Every order also has its own receipt." />
      <Panel title="Stops that are on">
        {!stops.ok ? <ApiState status={stops.status} code={stops.code} what="stops" /> : stops.data.length === 0 ? <Empty title="No stops are on" body="Trading isn't paused." /> : (
          <Table head={["Scope", "Reason"]}>{stops.data.map((s, i) => <tr key={i}><td>{s.scopeType}</td><td>{s.reason}</td></tr>)}</Table>
        )}
      </Panel>
      <Panel title="Full history" className="mt-4"><Empty title="Not available yet" body="A full activity timeline is still being built. Open any order to see its receipt." /></Panel>
      <TradingDisclosure />
    </>
  );
}
