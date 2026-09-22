// /products/metering — credits + per-call usage metering.
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { ProductPageView } from "@/components/ProductPageView";
import { PRODUCTS, relatedFor } from "@/lib/products";

const P = PRODUCTS.metering;

export const metadata: Metadata = buildMetadata({
  title: `${P.name} — credits and per-call usage`,
  description: P.definition,
  path: P.href,
});

export const revalidate = 300;

export default function Page() {
  return <ProductPageView product={P} related={relatedFor(P.slug)} />;
}
