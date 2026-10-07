import type { Metadata } from "next";
import { Empty, PageHeader, Panel, Table } from "@/components/ui";
import { ApiState, ModeBadge, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";
import { formatMinor } from "@/lib/trading/states";

export const metadata: Metadata = { title: "Positions" };

type Position = { instrument: string; mode: string; quantity: string; avgEntryPrice: string | null; realizedPnlMinor: string; currency: string; decimals: number };

export default async function PositionsPage() {
  requireAgentIa();
  const r = await tradingGet<Position[]>("/positions");
  return (
    <>
      <PageHeader title="Positions" lede="What you hold, built only from fills — never estimated." />
      <Panel title="Positions">
        {!r.ok ? <ApiState status={r.status} code={r.code} what="positions" /> : r.data.length === 0 ? <Empty title="No positions" body="Nothing has been filled yet." /> : (
          <Table head={["Instrument", "Mode", "Quantity", "Average entry", "Realised result"]} numeric={[2, 3, 4]}>
            {r.data.map((p) => (
              <tr key={`${p.instrument}-${p.mode}`}><td>{p.instrument}</td><td><ModeBadge mode={p.mode} /></td><td className="tnum">{p.quantity}</td><td className="tnum">{p.avgEntryPrice ?? "—"}</td>
                <td className="tnum">{formatMinor(p.realizedPnlMinor, p.decimals) ?? "—"} {p.currency}</td></tr>
            ))}
          </Table>
        )}
      </Panel>
      <TradingDisclosure />
    </>
  );
}
