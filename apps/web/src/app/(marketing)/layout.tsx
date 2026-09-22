// apps/web/src/app/(marketing)/layout.tsx
//
// Shared chrome for every public page. Data-driven (§6/§7): the mega-menu header
// and footer read the CMS Navigation/Footer globals via @satelink/content, which
// falls back to bundled fixtures when the CMS is unset/down — so the site always
// renders its full IA. The "(marketing)" route group is not part of the URL.
import { MegaMenuHeader, DataFooter } from "@satelink/web-ui";
import { getNavigation, getFooter, LEGAL_ENTITY } from "@satelink/content";
import { Toaster } from "@/components/ui/Toast";
import { SiteSearch } from "@/components/SiteSearch";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [nav, footer] = await Promise.all([getNavigation("satelink"), getFooter("satelink")]);

  return (
    <>
      <MegaMenuHeader nav={nav} search={<SiteSearch />} />
      <main style={{ paddingTop: "var(--header-height)" }}>{children}</main>
      <DataFooter
        footer={footer}
        entity={{ name: LEGAL_ENTITY.name, addressOneLine: LEGAL_ENTITY.addressOneLine }}
        // Customer stories hidden until ≥1 published (§7).
        emptyCollections={["customer-stories"]}
      />
      <Toaster />
    </>
  );
}
