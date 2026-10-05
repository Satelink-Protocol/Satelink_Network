import type { Metadata } from "next";
import { Badge, PageHeader, Panel, Table } from "@/components/ui";
import { TradingDisclosure } from "@/components/trading/parts";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "Brokers" };

// What exists in code today (Stages 21–23). Nothing here is connected for customers.
const BROKERS = [
  { name: "Binance", where: "Test network only", how: "Orders placed by the agent after your approval" },
  { name: "Upstox (India)", where: "Sandbox only", how: "You confirm every order; Satelink can prepare it for you to place yourself" },
  { name: "Alpaca (US)", where: "Sandbox only", how: "Orders placed after your approval" },
];

export default function BrokersPage() {
  requireAgentIa();
  return (
    <>
      <PageHeader title="Brokers" lede="Where orders would be sent. Satelink never holds your money — it stays with your broker." />
      <Panel title="Available connections">
        <Table head={["Broker", "Environment", "How orders work", "Connection"]}>
          {BROKERS.map((b) => (
            <tr key={b.name}><td>{b.name}</td><td>{b.where}</td><td>{b.how}</td><td><Badge>Not available yet</Badge></td></tr>
          ))}
        </Table>
        <p className="mt-2 text-sl-text-muted">Connecting your own broker account isn't open yet. When it is, Satelink will only ever ask for keys that can trade — never withdraw.</p>
      </Panel>
      <TradingDisclosure />
    </>
  );
}
