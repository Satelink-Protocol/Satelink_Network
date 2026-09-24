// Breadcrumbs (§8 templates). Renders a nav with an ordered trail; the caller
// also emits BreadcrumbList JSON-LD (@satelink/seo) with the same items.
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { name: string; href: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-[1200px] px-4 py-4 sm:px-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-sl-text-subtle">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={c.href} className="flex items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="text-sl-text-muted">{c.name}</span>
              ) : (
                <>
                  <Link href={c.href} className="transition-colors hover:text-sl-text">{c.name}</Link>
                  <ChevronRight className="size-3.5 opacity-60" aria-hidden />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
