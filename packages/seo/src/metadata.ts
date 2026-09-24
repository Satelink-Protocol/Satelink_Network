// Next Metadata builder (§12). Every major page: single title, description,
// canonical, OG/Twitter. Returns a plain object assignable to Next's `Metadata`
// without importing Next types here (peer-only).
import { SITES } from "@satelink/content";

export type PageMeta = {
  title: string;
  description: string;
  /** Absolute or path-relative canonical; path is resolved against the origin. */
  path: string;
  site?: keyof typeof SITES;
  ogImage?: string;
  noindex?: boolean;
  type?: "website" | "article";
};

export function buildMetadata(m: PageMeta) {
  const origin = SITES[m.site ?? "satelink"].origin;
  const canonical = m.path.startsWith("http") ? m.path : `${origin}${m.path}`;
  const images = m.ogImage ? [{ url: m.ogImage }] : undefined;
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical },
    robots: m.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title: m.title,
      description: m.description,
      url: canonical,
      siteName: SITES[m.site ?? "satelink"].name,
      type: m.type ?? "website",
      images,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: m.title,
      description: m.description,
      images: m.ogImage ? [m.ogImage] : undefined,
    },
  };
}
