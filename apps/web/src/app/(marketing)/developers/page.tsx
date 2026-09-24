// /developers — the developer hub. Real endpoints, no invented numbers. Two
// ways to authenticate (API key / keyless x402); links to quickstart, the API
// reference (docs), SDKs, and the MIT x402-kit.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { SITES } from "@satelink/content";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";

export const metadata: Metadata = buildMetadata({
  title: "Developers",
  description:
    "Build on Satelink: a REST API with keyless x402, the MIT x402-kit, and free discovery. Pay per call, no seat licence. Start with the quickstart.",
  path: "/developers",
});

const CARDS = [
  { title: "Quickstart", body: "From discovery to your first paid call in a few minutes.", href: "/developers/quickstart" },
  { title: "API reference", body: "Full endpoint, auth, and error reference.", href: SITES.docs.origin },
  { title: "SDKs", body: "The MIT x402-kit today; a typed SDK is planned.", href: "/developers/sdks" },
  { title: "API surface", body: "Products, auth, credits, and rate limits at a glance.", href: "/developers/api" },
];

export default function DevelopersHub() {
  return (
    <>
      <section className="mx-auto max-w-[1100px] px-4 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Developers</p>
        <h1 className="mx-auto mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">
          A REST API a machine can pay for.
        </h1>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg text-sl-text-muted">
          Discover services, authenticate with a key or keyless x402, and pay per call. No seat
          licence, no commitment — test with free discovery first.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link href="/developers/quickstart">Quickstart <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><a href={SITES.docs.origin}>API reference</a></Button>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((c) => (
            <Card key={c.title} interactive className="flex flex-col">
              <CardTitle className="text-base">{c.title}</CardTitle>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{c.body}</p>
              <Link href={c.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                Open <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="First call" title="Discovery is public — no signup" align="left" as="h2" />
          <p className="mt-3 max-w-2xl text-sm text-sl-text-muted">
            The discovery route lists every service, its price, and how to pay. Run it now:
          </p>
          <div className="mt-6 max-w-2xl">
            <CodeBlock
              tabs={[
                { label: "curl", code: `curl ${SITES.api.origin}/.well-known/satelink.json` },
                { label: "TS", code: `const res = await fetch(\n  "${SITES.api.origin}/.well-known/satelink.json"\n);\nconst discovery = await res.json();` },
                { label: "Python", code: `import requests\nr = requests.get("${SITES.api.origin}/.well-known/satelink.json")\nprint(r.json())` },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Authenticate" title="Two ways to identify a caller" align="left" as="h2" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card><CardTitle className="text-base">API key</CardTitle><p className="mt-2 text-sm text-sl-text-muted">Account callers present a key in the <code className="font-sl-mono">X-API-Key</code> header. Keys are issued and rotated in the console.</p></Card>
          <Card><CardTitle className="text-base">Keyless x402</CardTitle><p className="mt-2 text-sm text-sl-text-muted">No account: the price arrives in a 402 response and the caller pays in USDC on Base with an <code className="font-sl-mono">X-Payment</code> header.</p></Card>
        </div>
      </section>
    </>
  );
}
