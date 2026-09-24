import Link from "next/link";
import { businesses } from "@/content/businesses";
import { company, registeredOfficeLine } from "@/content/company";

const cols: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Businesses",
    links: [{ href: "/businesses", label: "Overview" }, ...businesses.map((b) => ({ href: `/businesses/${b.slug}`, label: b.short }))],
  },
  {
    title: "Company",
    links: [
      { href: "/company", label: "About" },
      { href: "/company/leadership", label: "Leadership" },
      { href: "/news", label: "News" },
      { href: "/careers", label: "Careers" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Technology",
    links: [
      { href: "/technology", label: "Satelink overview" },
      { href: "https://satelink.network", label: "satelink.network ↗" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/company-information", label: "Company information" },
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms of use" },
      { href: "/legal/grievance", label: "Grievance officer" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-stone-1 bg-ivory-2">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Link href="/" className="font-serif text-2xl">Jakuraa</Link>
            <p className="mt-3 text-sm text-stone-4">Established 2019 · Coimbatore, India</p>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <h2 className="text-sm font-medium text-ink">{c.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm text-stone-4">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="hover:text-ink">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 border-t border-stone-2/60 pt-6 text-xs leading-relaxed text-stone-4">
          <p>
            © {new Date().getFullYear()} {company.legalName} (formerly {company.formerName})
          </p>
          <p className="mt-1">
            CIN {company.cin} · GSTIN {company.gstin} · Registered office: {registeredOfficeLine()}
          </p>
        </div>
      </div>
    </footer>
  );
}
