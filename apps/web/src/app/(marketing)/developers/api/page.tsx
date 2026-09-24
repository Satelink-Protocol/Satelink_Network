// /developers/api — the API surface at a glance. Points to the full reference
// on docs.satelink.network for exact request/response and error values.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { Breadcrumbs } from "@satelink/web-ui";
import { SITES, DISCOVERY } from "@satelink/content";
import { FLAT_RATE_USD } from "@/lib/products";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = buildMetadata({
  title: "API surface — Developers",
  description:
    "The Satelink API surface: discovery, Trading Intelligence, RPC, credits, and the x402 rail. Authentication, errors, and rate limits — with the full reference on the docs.",
  path: "/developers/api",
});

const API = SITES.api.origin;

const ENDPOINTS = [
  { method: "GET", path: "/.well-known/satelink.json", note: "Public discovery — services + pricing." },
  { method: "GET", path: "/v1/intelligence", note: "Trading Intelligence catalog (metrics + prices)." },
  { method: "GET", path: "/v1/intelligence/{metric}", note: "One derived metric (metered)." },
  { method: "POST", path: "/rpc/polygon", note: `Polygon JSON-RPC (metered, $${FLAT_RATE_USD}/call).` },
  { method: "GET", path: "/credits/deposit/initiate", note: "Begin a USDT deposit to fund a balance." },
];

const FACTS = [
  { title: "Authentication", body: "X-API-Key header for accounts; keyless x402 (X-Payment header) for machine callers." },
  { title: "Payment required", body: "Unpaid metered calls return HTTP 402 with machine-readable requirements." },
  { title: "Errors", body: "Standard HTTP status codes — 402 payment required, 429 rate limited. Exact bodies are in the reference." },
  { title: "Rate limits", body: "Free discovery is rate-limited; funded calls run at standard limits. See the reference for values." },
];

export default function ApiSurfacePage() {
  return (
    <>
      <Breadcrumbs items={[{ name: "Developers", href: "/developers" }, { name: "API", href: "/developers/api" }]} />

      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <h1 className="text-4xl font-bold tracking-tight text-sl-text">API surface</h1>
        <p className="mt-4 max-w-[60ch] text-lg text-sl-text-muted">
          The endpoints, auth, and limits at a glance. For exact request and response shapes and
          error codes, see the full reference.
        </p>
        <div className="mt-6"><Button asChild><a href={SITES.docs.origin}>Full API reference</a></Button></div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Endpoints" title="What you can call" align="left" as="h2" />
        <div className="mt-8 overflow-x-auto rounded-[var(--sl-radius-lg)] border border-sl-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Method</th>
                <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Path</th>
                <th className="border-b border-sl-border px-4 py-3 text-left font-semibold text-sl-text">Description</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className="border-b border-sl-border px-4 py-3 font-sl-mono text-sl-accent">{e.method}</td>
                  <td className="border-b border-sl-border px-4 py-3 font-sl-mono text-sl-text-muted">{e.path}</td>
                  <td className="border-b border-sl-border px-4 py-3 text-sl-text-muted">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-sl-mono text-xs text-sl-text-subtle">Base URL: {API} · Discovery: {DISCOVERY.wellKnown}</p>
      </section>

      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Contract" title="Auth, errors, and limits" align="left" as="h2" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {FACTS.map((f) => (
              <div key={f.title} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
                <p className="font-semibold text-sl-text">{f.title}</p>
                <p className="mt-1.5 text-sm text-sl-text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/developers/quickstart">Quickstart</Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/platform/api">Platform: API</Link></Button>
        </div>
      </section>
    </>
  );
}
