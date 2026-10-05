import type { Metadata } from "next";
import { PageHeader, Panel, Table } from "@/components/ui";
import { ApiState, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage() {
  requireAgentIa();
  const [status, proposals] = await Promise.all([tradingGet<{ mcp: boolean }>("/status"), tradingGet<unknown[]>("/proposals")]);
  return (
    <>
      <PageHeader title="Agent" lede="The agent reads data and suggests orders. It cannot place, change or cancel orders — you approve every suggestion." />
      <Panel title="What the agent is allowed to do">
        <Table head={["Action", "Allowed?"]}>
          <tr><td>Read markets, positions, orders, limits</td><td>Yes</td></tr>
          <tr><td>Suggest an order for you to review</td><td>Yes — it waits for your approval</td></tr>
          <tr><td>Place, change or cancel an order</td><td>No, never</td></tr>
          <tr><td>Move money, see keys or passwords</td><td>No, never</td></tr>
        </Table>
        <p className="mt-2 text-sl-text-muted">Agent tools for other apps (MCP): {status.ok ? (status.data.mcp ? "on" : "off") : "unknown"}.</p>
      </Panel>
      <Panel title="Suggestions waiting for you" className="mt-4">
        {proposals.ok ? (proposals.data.length ? <p>{proposals.data.length} waiting</p> : <p className="text-sl-text-muted">No suggestions right now.</p>)
          : <ApiState status={proposals.status} code={proposals.code} what="agent suggestions" />}
      </Panel>
      <TradingDisclosure />
    </>
  );
}
