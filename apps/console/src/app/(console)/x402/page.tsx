import type { Metadata } from "next";
import { Badge, Empty, ErrorNote, PageHeader, Panel, Table } from "@/components/ui";
import { apiFetch } from "@/lib/api";

export const metadata: Metadata = { title: "x402" };

type WellKnown = {
  network: string;
  pay_to: string;
  asset: string;
  routes: { method: string; resource: string; price: string; description: string; live: boolean; note?: string }[];
};

export default async function X402Page() {
  const wk = await apiFetch<WellKnown>("/.well-known/x402", { revalidate: 300 });
  return (
    <>
      <PageHeader title="x402" lede="Keyless machine payments: USDC on Base, carried in the HTTP request." />
      {!wk.ok ? (
        <ErrorNote what="the x402 route list" />
      ) : (
        <>
          <Panel title="Payment terms">
            <Table head={["Field", "Value"]}>
              <tr><td className="text-sl-text-muted">Network</td><td className="font-mono">{wk.data.network} (Base)</td></tr>
              <tr><td className="text-sl-text-muted">Asset</td><td>{wk.data.asset}</td></tr>
              <tr><td className="text-sl-text-muted">Pay to</td><td className="font-mono">{wk.data.pay_to}</td></tr>
              <tr><td className="text-sl-text-muted">Discovery</td><td className="font-mono">https://api.satelink.network/.well-known/x402</td></tr>
            </Table>
          </Panel>
          <Panel title="Priced routes" className="mt-4">
            <Table head={["Route", "Price", "Status", "Notes"]}>
              {wk.data.routes.map((r) => (
                <tr key={r.method + r.resource}>
                  <td className="font-mono"><span className="text-sl-text-subtle">{r.method}</span> {r.resource.replace("https://rpc.satelink.network", "")}</td>
                  <td className="tnum">{r.price}</td>
                  <td>{r.live ? <Badge tone="good">live</Badge> : <Badge>not live</Badge>}</td>
                  <td className="text-sl-text-muted">{r.note || r.description}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        </>
      )}
      <Panel title="Your 402 events and payments" className="mt-4">
        <Empty
          title="x402 activity is tied to wallets, not keys"
          body="On the x402 rail the paying wallet is the identity, so these payments aren't linked to your API keys. A per-wallet view (402s issued vs payments settled — never conflated) arrives when you can link a wallet to your account."
        />
      </Panel>
    </>
  );
}
