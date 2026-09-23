// Console → Products (web-v3 P6). One page per product: Trading Intelligence
// (metric explorer), Machine Payments (x402 status + receipts), and RPC
// (endpoint + method usage). Live data is Track B; each widget shows an empty
// state until then (never "—").
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Panel, ConsoleEmpty } from "../../_components";

type Slug = "trading-intelligence" | "x402" | "rpc";

const PRODUCTS: Record<Slug, { title: string; lede: string; panels: { title: string; empty: { title: string; body: string } }[] }> = {
  "trading-intelligence": {
    title: "Trading Intelligence",
    lede: "Pick a metric and market, preview the response, and copy the request.",
    panels: [
      { title: "Metric explorer", empty: { title: "Pick a metric to preview", body: "Choose a metric and market to see a live preview and a copy-paste request. Available once your key is active." } },
      { title: "Recent metric calls", empty: { title: "No calls yet", body: "Your Trading-Intelligence calls will appear here." } },
    ],
  },
  x402: {
    title: "Machine Payments (x402)",
    lede: "Wallet and facilitator status, x402 receipts, and per-agent spend.",
    panels: [
      { title: "Wallet & facilitator", empty: { title: "No wallet connected", body: "Connect a wallet or use the keyless x402 flow; status will appear here." } },
      { title: "x402 receipts", empty: { title: "No receipts yet", body: "On-chain x402 receipts and per-agent spend will appear here." } },
    ],
  },
  rpc: {
    title: "RPC",
    lede: "Your endpoint, method usage, and errors.",
    panels: [
      { title: "Endpoint", empty: { title: "No endpoint yet", body: "Your metered Polygon RPC endpoint and its method usage will appear here once your key is active." } },
      { title: "Errors", empty: { title: "No errors", body: "RPC errors, if any, will be listed here." } },
    ],
  },
};

export function generateStaticParams() {
  return (Object.keys(PRODUCTS) as Slug[]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = PRODUCTS[slug as Slug];
  return { title: p ? p.title : "Product" };
}

export default async function ConsoleProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = PRODUCTS[slug as Slug];
  if (!product) notFound();

  return (
    <>
      <PageHeader title={product.title} lede={product.lede} />
      <div className="grid gap-4 lg:grid-cols-2">
        {product.panels.map((panel) => (
          <Panel key={panel.title} title={panel.title}>
            <ConsoleEmpty title={panel.empty.title} body={panel.empty.body} />
          </Panel>
        ))}
      </div>
    </>
  );
}
