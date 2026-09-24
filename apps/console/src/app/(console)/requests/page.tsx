import type { Metadata } from "next";
import { Empty, NeedsKey, PageHeader, Panel, Table } from "@/components/ui";
import { loadKey } from "@/lib/data";
import { int, usd } from "@/lib/format";
import { getActiveKey } from "@/lib/keys";

export const metadata: Metadata = { title: "Requests" };

export default async function RequestsPage() {
  const active = await getActiveKey();
  const d = active ? await loadKey(active.k) : null;
  const recent = d?.days ? [...d.days].reverse().slice(0, 14) : null;
  return (
    <>
      <PageHeader title="Requests" lede="Request activity for the active key." />
      {!active ? (
        <NeedsKey />
      ) : (
        <>
          <Panel title="Request log">
            <Empty
              title="Per-request logs are not exposed yet"
              body="The API records usage per key per day; an individual request log (status, latency, cost, receipt per call) needs a new read endpoint. Daily totals are below."
            />
          </Panel>
          <Panel title="Daily totals · last 14 days with activity" className="mt-4">
            {recent && recent.length > 0 ? (
              <Table head={["Date (UTC)", "Requests", "Charged"]} numeric={[1, 2]}>
                {recent.map((r) => (
                  <tr key={r.date}><td>{r.date}</td><td className="text-right">{int(r.calls)}</td><td className="text-right">{usd(r.spent, 5)}</td></tr>
                ))}
              </Table>
            ) : (
              <Empty title="No requests yet" body="Make a call with this key and it will appear here within a few minutes." cta={{ label: "RPC quickstart", href: "/rpc" }} />
            )}
          </Panel>
        </>
      )}
    </>
  );
}
