// /products/rpc — metered blockchain RPC (crypto rail). Canonicalized from /rpc.
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { ProductPageView } from "@/components/ProductPageView";
import { PRODUCTS, relatedFor } from "@/lib/products";

const P = PRODUCTS.rpc;

export const metadata: Metadata = buildMetadata({
  title: `${P.name} — pay-per-call Polygon RPC`,
  description: P.definition,
  path: P.href,
});

export const revalidate = 300;

export default function Page() {
  return <ProductPageView product={P} related={relatedFor(P.slug)} />;
}
