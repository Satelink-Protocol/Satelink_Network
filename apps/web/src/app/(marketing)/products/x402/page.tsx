// /products/x402 — the keyless, HTTP-native payment rail (USDC on Base).
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { ProductPageView } from "@/components/ProductPageView";
import { PRODUCTS, relatedFor } from "@/lib/products";

const P = PRODUCTS.x402;

export const metadata: Metadata = buildMetadata({
  title: `${P.name} — keyless HTTP 402 payments`,
  description: P.definition,
  path: P.href,
});

export const revalidate = 300;

export default function Page() {
  return (
    <ProductPageView
      product={P}
      related={relatedFor(P.slug)}
      primaryCta={{ label: "Get x402-kit", href: "https://github.com/Satelink-Protocol/x402-kit" }}
    />
  );
}
