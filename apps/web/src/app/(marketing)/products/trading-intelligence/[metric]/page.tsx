// /products/trading-intelligence/[metric] — one page per catalog metric,
// generated from the live catalog (params seeded from the static fallback so
// the build is offline-safe). Mandatory limitations block for modelled/proxy
// metrics (§2.5). Moved here from /intelligence/[metric] (canonical §3).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { getCatalog, getFallbackCatalog, getMetric } from "@/lib/intelligence";
import { STARTER_PACK_USD } from "@/lib/products";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Disclosure } from "@/components/ui/Disclosure";
import samples from "../../../../../../data/intelligence-samples.json";

type Sample = { fields: string[]; example: string };
const SAMPLES = samples as Record<string, Sample>;
const BASE_ROUTE = "/products/trading-intelligence";

export function generateStaticParams() {
  return getFallbackCatalog().metrics.map((m) => ({ metric: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ metric: string }>;
}): Promise<Metadata> {
  const { metric } = await params;
  const m = getMetric(getFallbackCatalog(), metric);
  if (!m) return { title: "Metric" };
  return buildMetadata({
    title: `${m.name} — Trading Intelligence`,
    description: m.description,
    path: `${BASE_ROUTE}/${m.slug}`,
  });
}

export const revalidate = 300;

export default async function MetricPage({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric } = await params;
  const { catalog } = await getCatalog();
  const m = getMetric(catalog, metric) ?? getMetric(getFallbackCatalog(), metric);
  if (!m) notFound();

  const sample = SAMPLES[m.slug];
  const base = "https://rpc.satelink.network/v1/intelligence";
  const url = `${base}/${m.slug}`;

  return (
    <>
      <Breadcrumbs items={[
        { name: "Products", href: "/product/overview" },
        { name: "Trading Intelligence", href: BASE_ROUTE },
        { name: m.name, href: `${BASE_ROUTE}/${m.slug}` },
      ]} />
      <article className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <Link href={BASE_ROUTE} className="inline-flex items-center gap-1.5 text-sm text-sl-text-muted hover:text-sl-text">
          <ArrowLeft className="size-4" /> All metrics
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-sl-text">{m.name}</h1>
          <Badge variant={m.isModel ? "model" : "neutral"}>{m.kind}</Badge>
          {m.isModel && <Badge variant="model">model / proxy</Badge>}
        </div>
        <p className="mt-2 font-sl-mono text-sm text-sl-accent">${m.priceUsd.toFixed(2)} / call</p>

        <h2 className="mt-10 text-lg font-semibold text-sl-text">What it measures</h2>
        <p className="mt-2 text-sm leading-relaxed text-sl-text-muted">{m.measures || m.description}</p>

        {sample && (
          <>
            <h2 className="mt-8 text-lg font-semibold text-sl-text">Fields returned</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {sample.fields.map((f) => (
                <li key={f} className="rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-surface px-2.5 py-1 font-sl-mono text-xs text-sl-text-muted">
                  {f}
                </li>
              ))}
            </ul>

            <h2 className="mt-8 text-lg font-semibold text-sl-text">Example response</h2>
            <p className="mt-1 text-xs text-sl-text-subtle">Example shape — values are placeholders, not live data.</p>
            <div className="mt-3">
              <CodeBlock code={sample.example} />
            </div>
          </>
        )}

        <h2 className="mt-8 text-lg font-semibold text-sl-text">Example request</h2>
        <div className="mt-3">
          <CodeBlock
            tabs={[
              { label: "curl", code: `curl -H "X-API-Key: $SATELINK_KEY" \\\n  ${url}` },
              { label: "TS", code: `const res = await fetch("${url}", {\n  headers: { "X-API-Key": process.env.SATELINK_KEY! },\n});\nconst data = await res.json();` },
              { label: "Python", code: `import os, requests\nr = requests.get(\n  "${url}",\n  headers={"X-API-Key": os.environ["SATELINK_KEY"]},\n)\nprint(r.json())` },
            ]}
          />
        </div>

        {m.isModel && (
          <div className="mt-8">
            <Disclosure title="Limitations — this is a model, not a measurement">
              This metric is a modelled proxy. It infers likely structure from public price and
              open-interest data and does <strong>not</strong> report real, measured liquidation orders.
              Treat outputs as research inputs, not ground truth. Model outputs can be wrong, especially in
              fast-moving or thin markets. Nothing here is investment advice.
            </Disclosure>
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3 border-t border-sl-border pt-8">
          <Button asChild size="lg"><Link href="/checkout?plan=starter">Start with ${STARTER_PACK_USD} <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><a href="https://docs.satelink.network">Read the docs</a></Button>
        </div>
      </article>
    </>
  );
}
