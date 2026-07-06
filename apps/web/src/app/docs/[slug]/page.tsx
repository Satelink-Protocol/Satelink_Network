import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DOCS, getDocEntry, getDocMarkdown } from "@/lib/docs";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDocEntry(slug);
  if (!doc) return {};
  const canonical = `https://docs.satelink.network/docs/${doc.slug}`;
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical },
    openGraph: {
      title: `${doc.title} — Satelink Docs`,
      description: doc.description,
      url: canonical,
      siteName: "Satelink Docs",
      type: "article",
    },
    twitter: {
      card: "summary",
      title: `${doc.title} — Satelink Docs`,
      description: doc.description,
    },
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = getDocEntry(slug);
  if (!doc) notFound();

  const markdown = getDocMarkdown(doc.slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: doc.title,
    description: doc.description,
    url: `https://docs.satelink.network/docs/${doc.slug}`,
    isPartOf: {
      "@type": "WebSite",
      name: "Satelink Documentation",
      url: "https://docs.satelink.network",
    },
    publisher: {
      "@type": "Organization",
      name: "Satelink Network",
      url: "https://satelink.network",
    },
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: "https://docs.satelink.network" },
      { "@type": "ListItem", position: 2, name: doc.category },
      { "@type": "ListItem", position: 3, name: doc.title, item: `https://docs.satelink.network/docs/${doc.slug}` },
    ],
  };

  return (
    <article className="docs-article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <nav className="docs-breadcrumbs" aria-label="Breadcrumb">
        <Link href="/docs">Docs</Link>
        <span aria-hidden>/</span>
        <span>{doc.category}</span>
        <span aria-hidden>/</span>
        <span aria-current="page">{doc.title}</span>
      </nav>
      <h1>{doc.title}</h1>
      <p className="docs-lede">{doc.description}</p>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </article>
  );
}
