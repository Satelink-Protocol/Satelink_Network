// Typed JSON-LD builders (§12). Sitewide: Organization + WebSite (SearchAction).
// Per-page: WebPage + BreadcrumbList; Product/Offer or SoftwareApplication on
// product pages; Article/NewsArticle/TechArticle for content; FAQPage only
// where FAQs are visible; HowTo for tutorials. Types come from schema-dts so a
// malformed graph fails typecheck, not just runtime validation.
import type {
  Organization,
  WebSite,
  WebPage,
  BreadcrumbList,
  Product,
  Article,
  FAQPage,
  HowTo,
  WithContext,
} from "schema-dts";
import { LEGAL_ENTITY, SITES } from "@satelink/content";

const CTX = "https://schema.org" as const;

export function organizationLd(opts?: { sameAs?: string[] }): WithContext<Organization> {
  return {
    "@context": CTX,
    "@type": "Organization",
    name: SITES.satelink.name,
    legalName: LEGAL_ENTITY.name,
    url: SITES.satelink.origin,
    address: {
      "@type": "PostalAddress",
      streetAddress: LEGAL_ENTITY.addressLines.slice(0, 2).join(", "),
      addressLocality: "Coimbatore",
      addressRegion: "Tamil Nadu",
      postalCode: "641009",
      addressCountry: LEGAL_ENTITY.country,
    },
    ...(opts?.sameAs?.length ? { sameAs: opts.sameAs } : {}),
  };
}

export function webSiteLd(): WithContext<WebSite> {
  return {
    "@context": CTX,
    "@type": "WebSite",
    name: SITES.satelink.name,
    url: SITES.satelink.origin,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITES.satelink.origin}/search?q={query}`,
      },
      // schema-dts wants query-input on SearchAction:
      "query-input": "required name=query",
    } as WebSite["potentialAction"],
  };
}

export function webPageLd(p: { url: string; name: string; description?: string }): WithContext<WebPage> {
  return {
    "@context": CTX,
    "@type": "WebPage",
    url: p.url,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]): WithContext<BreadcrumbList> {
  return {
    "@context": CTX,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function productLd(p: {
  name: string;
  description: string;
  url: string;
  price?: number;
  currency?: string;
}): WithContext<Product> {
  return {
    "@context": CTX,
    "@type": "Product",
    name: p.name,
    description: p.description,
    url: p.url,
    ...(p.price != null
      ? {
          offers: {
            "@type": "Offer",
            price: p.price.toFixed(2),
            priceCurrency: p.currency ?? "USD",
            url: p.url,
          },
        }
      : {}),
  };
}

export function articleLd(p: {
  headline: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
  image?: string;
  type?: "Article" | "NewsArticle" | "TechArticle";
}): WithContext<Article> {
  return {
    "@context": CTX,
    "@type": p.type ?? "Article",
    headline: p.headline,
    url: p.url,
    datePublished: p.datePublished,
    dateModified: p.dateModified ?? p.datePublished,
    ...(p.author ? { author: { "@type": "Person", name: p.author } } : {}),
    ...(p.image ? { image: p.image } : {}),
  };
}

export function faqLd(items: { question: string; answer: string }[]): WithContext<FAQPage> {
  return {
    "@context": CTX,
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: { "@type": "Answer", text: it.answer },
    })),
  };
}

export function howToLd(p: {
  name: string;
  steps: { name: string; text: string }[];
}): WithContext<HowTo> {
  return {
    "@context": CTX,
    "@type": "HowTo",
    name: p.name,
    step: p.steps.map((s) => ({ "@type": "HowToStep", name: s.name, text: s.text })),
  };
}

/** Serialize a graph for a <script type="application/ld+json"> tag. */
export function jsonLdScript(graph: object | object[]): string {
  return JSON.stringify(graph);
}
