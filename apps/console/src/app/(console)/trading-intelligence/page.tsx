import type { Metadata } from "next";
import { TiPlayground } from "@/components/TiPlayground";
import { Badge, ErrorNote, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { getActiveKey } from "@/lib/keys";

export const metadata: Metadata = { title: "Trading Intelligence" };

type Catalog = { ok: true; metrics: { metric: string; price_usdt: number; description: string; kind: string; resource: string }[] };

export default async function TradingIntel() {
  const [cat, active] = await Promise.all([apiFetch<Catalog>("/v1/intelligence", { revalidate: 300 }), getActiveKey()]);
  return (
    <>
      <PageHeader title="Trading Intelligence" lede="Derived market analytics, bought per call. Not investment advice." />
      {!cat.ok ? (
        <ErrorNote what="the metric catalog" />
      ) : (
        <>
          <Panel title="Metric explorer">
            <Table head={["Metric", "Kind", "Price", "Description"]} numeric={[2]}>
              {cat.data.metrics.map((m) => (
                <tr key={m.metric}>
                  <td className="font-mono text-sl-text">{m.metric}</td>
                  <td><Badge tone={m.kind === "derived-model" ? "warn" : "market"}>{m.kind}</Badge></td>
                  <td className="text-right">{m.price_usdt} USDT</td>
                  <td className="text-sl-text-muted">{m.description}</td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="API playground" className="mt-4">
            <TiPlayground metrics={cat.data.metrics} hasKey={!!active} />
          </Panel>
          <Panel title="Saved queries" className="mt-4">
            <p className="text-sl-text-muted">Saved queries arrive with server-side account storage. Use the playground or call the API directly meanwhile.</p>
          </Panel>
        </>
      )}
    </>
  );
}
