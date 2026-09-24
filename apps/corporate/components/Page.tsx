import Link from "next/link";

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function PageHero({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: React.ReactNode }) {
  return (
    <Container className="pb-12 pt-16 sm:pb-16 sm:pt-24">
      {eyebrow && <p className="text-sm font-medium text-green">{eyebrow}</p>}
      <h1 className="mt-3 max-w-4xl font-serif text-[2.5rem] leading-[1.08] tracking-tight sm:text-6xl">{title}</h1>
      {lede && <div className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-4 sm:text-xl">{lede}</div>}
    </Container>
  );
}

export function SectionHeading({ title, lede, id }: { title: string; lede?: string; id?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{title}</h2>
      {lede && <p className="mt-4 text-lg leading-relaxed text-stone-4">{lede}</p>}
    </div>
  );
}

export function Rule() {
  return <hr className="border-stone-1" />;
}

export function ArrowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  return (
    <Link href={href} className="group inline-flex items-center gap-1.5 font-medium text-green" {...(external ? { rel: "noopener" } : {})}>
      {children}
      <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-2 px-6 py-12 text-center sm:px-12">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mx-auto mt-3 max-w-md text-stone-4">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function DefinitionList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-stone-1 border-y border-stone-1">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 py-4 sm:grid-cols-[240px_1fr] sm:gap-6">
          <dt className="text-sm text-stone-3">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
