import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { company } from "@/content/company";

const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const SITE = company.site;

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Jakuraa — a technology and trading company, established 2019",
    template: "%s — Jakuraa",
  },
  description:
    "Jakuraa Commercial Private Limited is a Coimbatore-based company established in 2019. It operates Satelink, machine-commerce infrastructure, and holds registrations for trading, international trade and industrial manufacturing.",
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Jakuraa",
    title: "Jakuraa",
    description: "A technology and trading company, established 2019. Operator of Satelink.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#faf8f3" };

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: company.shortName,
  legalName: company.legalName,
  alternateName: company.formerName,
  url: SITE,
  email: company.email,
  foundingDate: company.incorporated,
  taxID: company.gstin,
  identifier: [{ "@type": "PropertyValue", propertyID: "CIN", value: company.cin }],
  address: {
    "@type": "PostalAddress",
    streetAddress: company.registeredOffice.street,
    addressLocality: company.registeredOffice.locality,
    addressRegion: company.registeredOffice.region,
    postalCode: company.registeredOffice.postalCode,
    addressCountry: company.registeredOffice.countryCode,
  },
  subOrganization: {
    "@type": "Organization",
    name: "Satelink",
    url: "https://satelink.network",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-screen">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
