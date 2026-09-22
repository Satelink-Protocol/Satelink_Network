// Data-driven footer (§7). Presentational; takes Footer data + the legal entity.
// Columns whose only links are all hidden-when-empty are still shown (the link,
// not the column, is hidden) — hiding is resolved by the app before render.
import Link from "next/link";
import { ThemeToggle } from "../ui/ThemeToggle";

export type FLink = { label: string; href: string; hideWhenEmptyCollection?: string };
export type FColumn = { title: string; links: FLink[] };
export type FooterData = { columns: FColumn[]; secondary: FColumn[]; social: { platform: string; href: string }[] };

export function DataFooter({
  footer,
  entity,
  /** Collections known to be empty → their links are hidden (§7 auto-hide). */
  emptyCollections = [],
}: {
  footer: FooterData;
  entity: { name: string; addressOneLine: string };
  emptyCollections?: string[];
}) {
  const visible = (links: FLink[]) => links.filter((l) => !(l.hideWhenEmptyCollection && emptyCollections.includes(l.hideWhenEmptyCollection)));
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-sl-border bg-sl-surface">
      <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-6">
          {footer.columns.map((col) => (
            <FooterCol key={col.title} title={col.title} links={visible(col.links)} />
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-8 border-t border-sl-border pt-10 sm:grid-cols-3">
          {footer.secondary.map((col) => (
            <FooterCol key={col.title} title={col.title} links={visible(col.links)} />
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-sl-border pt-8 text-sm text-sl-text-subtle sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p>© {year} {entity.name}</p>
            <p className="mt-1 text-xs">{entity.addressOneLine}</p>
          </div>
          <div className="flex items-center gap-4">
            {footer.social.map((s) => (
              <a key={s.platform} href={s.href} className="hover:text-sl-text" rel="noopener noreferrer" target="_blank">{s.platform}</a>
            ))}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: FLink[] }) {
  if (!links.length) return null;
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">{title}</p>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="text-sm text-sl-text-muted transition-colors hover:text-sl-text">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
