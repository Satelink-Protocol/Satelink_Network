// /developers/quickstart — discover → authenticate → first call → fund → go
// keyless. Every example runs against a real endpoint (§: code runs or carries
// an Illustrative badge). The x402 step shows the real 402 shape, labelled.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { SITES } from "@satelink/content";
import { FLAT_RATE_USD, X402_BUNDLE } from "@/lib/products";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = buildMetadata({
  title: "Quickstart — Developers",
  description:
    "Get from discovery to your first paid Satelink call: read the catalog, authenticate with a key or keyless x402, make a call, and fund a balance. Every step runs against a live endpoint.",
  path: "/developers/quickstart",
});

const API = SITES.api.origin;

const STEPS = [
  {
    title: "1 · Discover",
    body: "List every service, its price, and how to pay — public, no signup.",
    code: `curl ${API}/.well-known/satelink.json`,
    illustrative: false,
  },
  {
    title: "2 · Read the catalog",
    body: "The Trading Intelligence catalog returns each metric and its per-call price.",
    code: `curl ${API}/v1/intelligence`,
    illustrative: false,
  },
  {
    title: "3 · Make a call with an API key",
    body: "Account callers pass a key. Metered calls draw from your balance.",
    code: `curl -H "X-API-Key: $SATELINK_KEY" \\\n  ${API}/v1/intelligence/funding-rate-heatmap`,
    illustrative: false,
  },
  {
    title: "4 · Fund a balance",
    body: "Initiate a USDT deposit to credit your balance; calls draw down at the flat rate.",
    code: `curl "${API}/credits/deposit/initiate?amount=10"`,
    illustrative: false,
  },
  {
    title: "5 · Go keyless with x402",
    body: `No account: the service answers with a 402, you pay in USDC on Base, the call completes. One bundle is $${X402_BUNDLE.priceUsd} for ${X402_BUNDLE.calls.toLocaleString()} RPC calls.`,
    code: `# The unpaid call is answered with the price:
HTTP/1.1 402 Payment Required
{ "accepts": [{ "scheme": "x402", "network": "eip155:8453",
    "maxAmountRequired": "0.01", "asset": "USDC" }] }`,
    illustrative: true,
  },
];

export default function QuickstartPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Developers", href: "/developers" }, { name: "Quickstart", href: "/developers/quickstart" }]} />

      <section className="mx-auto max-w-[820px] px-4 pt-6 sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight text-sl-text">Quickstart</h1>
        <p className="mt-4 text-lg text-sl-text-muted">
          From discovery to a paid call. Steps 1–4 run against live endpoints; step 5 shows the
          real x402 handshake. RPC and machine-commerce calls are billed at a flat ${FLAT_RATE_USD}.
        </p>
      </section>

      <section className="mx-auto max-w-[820px] px-4 py-12 sm:px-6">
        <ol className="space-y-8">
          {STEPS.map((s) => (
            <li key={s.title}>
              <h2 className="font-sl-mono text-sm font-semibold tracking-wide text-sl-accent">{s.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-sl-text-muted">{s.body}</p>
              {s.illustrative && (
                <p className="mt-3 text-right text-xs text-sl-text-subtle">
                  Example shape
                  <span className="ml-2 rounded bg-sl-warn/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sl-warn">Illustrative</span>
                </p>
              )}
              <div className="mt-3"><CodeBlock code={s.code} ariaLabel={s.title} /></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-[820px] px-4 pb-16 sm:px-6">
        <div className="flex flex-wrap gap-3 border-t border-sl-border pt-8">
          <Button asChild size="lg"><a href={SITES.docs.origin}>Full API reference</a></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/developers/sdks">SDKs & x402-kit</Link></Button>
        </div>
      </section>
    </>
  );
}
