// apps/web/src/app/(marketing)/layout.tsx
//
// Shared chrome for every standalone public product/legal page (pricing,
// intelligence, intelligence/success, contact, privacy, refund, terms).
// A Next.js route group — the "(marketing)" segment is not part of the URL,
// so /pricing etc. are unchanged. Fixes the pages rendering with no header/
// footer/nav (2026-09-22 audit) by reusing the same SiteHeader/SiteFooter
// as the homepage instead of each page shipping (or omitting) its own.
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main style={{ paddingTop: "var(--header-height)" }}>{children}</main>
      <SiteFooter />
    </>
  );
}
