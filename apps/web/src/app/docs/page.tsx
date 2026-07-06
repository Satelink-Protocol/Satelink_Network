import type { Metadata } from "next";
import Link from "next/link";
import { docsByCategory } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Satelink Documentation",
  description:
    "Everything you need to build on Satelink: quick start, API reference, billing and credits, node operation, machine onboarding, and the on-chain revenue model.",
  alternates: { canonical: "https://docs.satelink.network" },
  openGraph: {
    title: "Satelink Documentation",
    description:
      "Docs for the Satelink DePIN RPC network — pay-per-call USDT metering on Polygon PoS.",
    url: "https://docs.satelink.network",
    siteName: "Satelink Docs",
    type: "website",
  },
};

export default function DocsIndexPage() {
  const groups = docsByCategory();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Satelink Documentation",
    url: "https://docs.satelink.network",
    description:
      "Documentation for the Satelink DePIN RPC network on Polygon PoS: pay-per-call USDT metering, permissionless deposits, node operation, and machine onboarding.",
    publisher: {
      "@type": "Organization",
      name: "Satelink Network",
      url: "https://satelink.network",
    },
  };

  return (
    <article className="docs-article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h1>Satelink Documentation</h1>
      <p className="docs-lede">
        Satelink is a DePIN RPC gateway on Polygon PoS. Developers and
        autonomous machines pay <strong>$0.00003 per call</strong> in USDT;
        node operators earn 50% of routed revenue; everything settles through
        an on-chain vault you can verify on Polygonscan. Start with the Quick
        Start — your first call takes under two minutes and needs no account.
      </p>

      {groups.map((g) => (
        <section key={g.category}>
          <h2>{g.category}</h2>
          <div className="docs-index-grid">
            {g.docs.map((d) => (
              <Link key={d.slug} href={`/docs/${d.slug}`} className="docs-index-card">
                <h3>{d.title}</h3>
                <p>{d.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
