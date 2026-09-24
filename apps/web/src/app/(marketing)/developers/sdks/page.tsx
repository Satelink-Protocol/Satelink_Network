// /developers/sdks — the MIT x402-kit (live) plus a planned typed SDK and MCP
// server. Planned items are labelled; no fabricated package names or versions.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { SITES } from "@satelink/content";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";

export const metadata: Metadata = buildMetadata({
  title: "SDKs & x402-kit — Developers",
  description:
    "The MIT-licensed x402-kit implements the HTTP 402 handshake against the live mainnet rail. A typed SDK and an MCP server are planned.",
  path: "/developers/sdks",
});

const KITS = [
  { title: "x402-kit (MIT)", status: null, body: "Drop-in middleware and client for the HTTP 402 handshake, with proven mainnet settlements.", href: "https://github.com/Satelink-Protocol/x402-kit", cta: "View on GitHub" },
  { title: "Typed SDK", status: "Planned", body: "A typed client library over the REST API.", href: SITES.docs.origin, cta: "Follow the docs" },
  { title: "MCP / agent server", status: "Planned", body: "An MCP server so agents can discover and pay for Satelink tools.", href: SITES.docs.origin, cta: "Follow the docs" },
];

export default function SdksPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Developers", href: "/developers" }, { name: "SDKs", href: "/developers/sdks" }]} />

      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight text-sl-text">SDKs & x402-kit</h1>
        <p className="mt-4 max-w-[60ch] text-lg text-sl-text-muted">
          You can call the API with plain HTTP — no dependency required. When you want the 402
          handshake done for you, use the open-source x402-kit.
        </p>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {KITS.map((k) => (
            <Card key={k.title} className="flex flex-col">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{k.title}</CardTitle>
                {k.status && <span className="rounded bg-sl-warn/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sl-warn">{k.status}</span>}
              </div>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{k.body}</p>
              <a href={k.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">{k.cta} →</a>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="No dependency" title="Plain HTTP works too" align="left" as="h2" />
          <p className="mt-3 max-w-2xl text-sm text-sl-text-muted">
            Any HTTP client can call the API with an <code className="font-sl-mono">X-API-Key</code> header:
          </p>
          <div className="mt-6 max-w-2xl">
            <CodeBlock
              tabs={[
                { label: "curl", code: `curl -H "X-API-Key: $SATELINK_KEY" \\\n  ${SITES.api.origin}/v1/intelligence/funding-rate-heatmap` },
                { label: "TS", code: `const res = await fetch(\n  "${SITES.api.origin}/v1/intelligence/funding-rate-heatmap",\n  { headers: { "X-API-Key": process.env.SATELINK_KEY! } }\n);` },
                { label: "Python", code: `import os, requests\nr = requests.get(\n  "${SITES.api.origin}/v1/intelligence/funding-rate-heatmap",\n  headers={"X-API-Key": os.environ["SATELINK_KEY"]},\n)` },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/developers/quickstart">Quickstart</Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/products/x402">About x402</Link></Button>
        </div>
      </section>
    </>
  );
}
