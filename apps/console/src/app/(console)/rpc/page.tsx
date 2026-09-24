import type { Metadata } from "next";
import { Badge, NeedsKey, PageHeader, Panel, Table } from "@/components/ui";
import { loadKey, windowSum } from "@/lib/data";
import { int, usd } from "@/lib/format";
import { getActiveKey } from "@/lib/keys";

export const metadata: Metadata = { title: "RPC" };

const METHODS = ["eth_blockNumber", "eth_call", "eth_getBalance", "eth_getLogs", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_sendRawTransaction", "eth_getCode", "eth_estimateGas", "eth_getStorageAt"];

export default async function RpcPage() {
  const active = await getActiveKey();
  const d = active ? await loadKey(active.k) : null;
  return (
    <>
      <PageHeader title="RPC" lede="Metered Polygon PoS (chain 137) JSON-RPC." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Endpoint">
          <Table head={["Field", "Value"]}>
            <tr><td className="text-sl-text-muted">URL</td><td className="font-mono">https://rpc.satelink.network/rpc/polygon</td></tr>
            <tr><td className="text-sl-text-muted">Method</td><td className="font-mono">POST · JSON-RPC 2.0</td></tr>
            <tr><td className="text-sl-text-muted">Auth</td><td>X-API-Key header, or keyless via x402</td></tr>
            <tr><td className="text-sl-text-muted">Price</td><td className="tnum">$0.00003 per call · x402 bundle $0.10 = 1,000 calls</td></tr>
            <tr><td className="text-sl-text-muted">Rail</td><td><Badge tone="machine">crypto rail</Badge> <span className="text-sl-text-muted">USDT credits or USDC via x402 — not card</span></td></tr>
          </Table>
        </Panel>
        <Panel title="Quickstart">
          <pre tabIndex={0} className="overflow-x-auto rounded border border-sl-border bg-sl-bg p-2 font-mono text-[11px] text-sl-text-muted">{`curl -X POST https://rpc.satelink.network/rpc/polygon \\
  -H "X-API-Key: $SATELINK_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`}</pre>
        </Panel>
      </div>
      <Panel title="Methods" className="mt-4">
        <p className="mb-2 text-sl-text-muted">The full standard method set is proxied. Common methods:</p>
        <div className="flex flex-wrap gap-1.5">{METHODS.map((m) => <code key={m} className="rounded border border-sl-border px-1.5 py-0.5 font-mono text-[11px]">{m}</code>)}</div>
      </Panel>
      <Panel title="Usage on the active key · all products" className="mt-4">
        {!active ? <NeedsKey /> : d?.days ? (
          <Table head={["Window", "Requests", "Charged"]} numeric={[1, 2]}>
            {[1, 7, 30].map((n) => (
              <tr key={n}><td>{n === 1 ? "Today" : `${n} days`}</td><td className="text-right">{int(windowSum(d.days!, n, "calls"))}</td><td className="text-right">{usd(windowSum(d.days!, n, "spent"), 5)}</td></tr>
            ))}
          </Table>
        ) : <p className="text-sl-text-muted">Usage unavailable right now.</p>}
        <p className="mt-2 text-[11px] text-sl-text-subtle">The API reports usage per key, not per product; if this key also calls Trading Intelligence, those calls are included. Error rates per method are not exposed yet.</p>
      </Panel>
    </>
  );
}
