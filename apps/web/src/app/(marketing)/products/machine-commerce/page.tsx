// /products/machine-commerce — the canonical Machine Commerce explanation (§3).
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { ProductPageView } from "@/components/ProductPageView";
import { PRODUCTS, relatedFor } from "@/lib/products";

const P = PRODUCTS["machine-commerce"];

export const metadata: Metadata = buildMetadata({
  title: `${P.name} — software that pays software`,
  description: P.definition,
  path: P.href,
});

export const revalidate = 300;

export default function Page() {
  return <ProductPageView product={P} related={relatedFor(P.slug)} />;
}
