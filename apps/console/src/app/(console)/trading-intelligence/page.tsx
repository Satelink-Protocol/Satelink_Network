import type { Metadata } from "next";
import { TiPlayground } from "@/components/TiPlayground";
import { Badge, ErrorNote, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { getActiveKey } from "@/lib/keys";
import { accountsEnabled } from "@/lib/account";
import { loadIntelCatalog, loadKeys, loadPlan, loadRequests, loadSavedQueries } from "@/lib/v2";
import { DataFlow } from "@/components/v2/DataFlow";
import { SavedQueries } from "@/components/v2/SavedQueries";

export const metadata: Metadata = { title: "Trading Intelligence" };

type Catalog = { ok: true; metrics: { metric: string; price_usdt: number; description: string; kind: string; resource: string }[] };

export default async function TradingIntel() {
  if (accountsEnabled()) return <TradingIntelV2 />;
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

type Universe = { ok: true; as_of: string | null; exchanges: string[]; symbols: string[] };
function age(asOf: string | null) {
  if (!asOf) return "no data yet";
  const min = Math.round((Date.now() - new Date(asOf).getTime()) / 60000);
  return min < 1 ? "just now" : min < 90 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

async function TradingIntelV2() {
  const [catalog, keys, plan, saved, history] = await Promise.all([
    loadIntelCatalog(), loadKeys(), loadPlan(), loadSavedQueries(), loadRequests("limit=20&product=intelligence"),
  ]);
  const metrics = catalog?.metrics ?? [];
  // Free, per-metric freshness (no charge): the snapshot time and the venues it came from.
  const fresh = await Promise.all(metrics.map((m) => apiFetch<Universe>(`/v1/intelligence/${m.metric}/universe`, { revalidate: 60 })));
  const runKeys = keys.ok ? keys.data.filter((k) => k.status === "active" && !k.limits.paused && (!k.limits.scopes || k.limits.scopes.includes("intelligence"))).map((k) => ({ id: k.id, label: k.label, hint: k.hint, balanceUsdt: k.balanceUsdt })) : [];
  return (
    <>
      <PageHeader title="Trading Intelligence" lede="Derived market analytics computed from public exchange data, bought per request. Not investment advice." />
      {!catalog ? <ErrorNote what="the metric catalog" /> : (
        <Panel title="Metrics">
          <Table head={["Metric", "Kind", "Price", "Data as of", "Venues", "Description"]} numeric={[2]}>
            {metrics.map((m, i) => {
              const f = fresh[i];
              return (
                <tr key={m.metric}>
                  <td className="font-mono text-sl-text">{m.metric}</td>
                  <td><Badge tone={m.kind === "derived-model" ? "warn" : "market"}>{m.kind}</Badge></td>
                  <td className="text-right">${m.price_usdt.toFixed(2)}</td>
                  <td className="whitespace-nowrap text-sl-text-muted" title={f.ok && f.data.as_of ? new Date(f.data.as_of).toISOString() : ""}>{f.ok ? age(f.data.as_of) : "unavailable"}</td>
                  <td className="text-sl-text-muted">{f.ok && f.data.exchanges.length ? f.data.exchanges.join(", ") : "—"}</td>
                  <td className="text-sl-text-muted">{m.description}</td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-2 text-[11px] text-sl-text-subtle">“derived” = computed from market data; “derived-model” = a model estimate built on it. Neither is a recommendation to trade. NOT INVESTMENT ADVICE.</p>
        </Panel>
      )}
      <Panel title="Saved queries" className="mt-4">
        {saved.ok ? <SavedQueries initial={saved.data} /> : <ErrorNote what="your saved queries" />}
      </Panel>
      <Panel title="Run a metric" className="mt-4">
        <DataFlow metrics={metrics} keys={runKeys} plan={plan.ok ? plan.data : null} />
      </Panel>
      <Panel title="Recent market-data requests" className="mt-4">
        {!history.ok ? <ErrorNote what="your request history" /> : history.data.items.length === 0 ? (
          <p className="text-sl-text-muted">No market-data requests yet. Run a metric above — each run appears here with its cost and receipt.</p>
        ) : (
          <Table head={["Time", "Metric", "Key", "Status", "Cost", "Receipt"]} numeric={[4]}>
            {history.data.items.map((r) => (
              <tr key={`${r.receiptId}-${r.at}`}>
                <td className="whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
                <td className="font-mono">{r.method}</td>
                <td>{r.key.label}</td>
                <td>{r.status}</td>
                <td className="text-right">${r.costUsdt.toFixed(2)}</td>
                <td className="max-w-[12rem] truncate font-mono text-sl-text-muted" title={r.receiptId ?? ""}>{r.receiptId ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
