// Generic platform page (§7 PlatformTemplate order): Hero · capability
// sections · "Control cost" · Console (Build·Deploy·Monitor·Manage → real
// /satelink/os screens) · Technical resources · CTA. The feature carousel is
// changelog-driven and auto-hidden until the changelog ships (§2). Server
// component; no invented screenshots or numbers.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@satelink/web-ui";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { CONSOLE_MAP, type PlatformFacts } from "@/lib/platform";

export function PlatformPageView({ platform }: { platform: PlatformFacts }) {
  return (
    <>
      <Breadcrumbs items={[{ name: "Platform", href: "/platform" }, { name: platform.name, href: platform.href }]} />

      {/* Hero */}
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Platform</p>
        <h1 className="mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">
          {platform.tagline}
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-sl-text-muted">{platform.definition}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href="/developers/quickstart">Start building <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/platform">All of the platform</Link></Button>
        </div>
      </section>

      {/* Capability sections */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Capabilities" title={`What ${platform.name} provides`} align="left" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {platform.sections.map((s) => (
            <div key={s.title} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sl-text">{s.title}</p>
                {s.status && (
                  <span className="rounded bg-sl-warn/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sl-warn">{s.status}</span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-sl-text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Control cost */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Control cost" title="Spend stays bounded" align="left" />
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {platform.controlCost.map((c) => (
              <li key={c} className="flex items-start gap-2.5 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4 text-sm text-sl-text-muted">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sl-accent" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Console */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <SectionHeader eyebrow="Console" title="Build · Deploy · Monitor · Manage" align="left" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CONSOLE_MAP.map((c) => (
            <Link key={c.verb} href={c.href} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
              <p className="font-semibold text-sl-text">{c.verb}</p>
              <p className="mt-1.5 text-sm text-sl-text-muted">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Technical resources */}
      <section className="border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Technical resources" title="Go deeper" align="left" />
          <div className="mt-8 flex flex-wrap gap-3">
            {platform.resources.map((r) => (
              <a key={r.href} href={r.href} className="rounded-[var(--sl-radius-sm)] border border-sl-border px-3 py-2 text-sm text-sl-text-muted transition-colors hover:border-sl-accent hover:text-sl-text">
                {r.label}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface px-6 py-12 text-center">
          <h2 className="font-sl-display text-[1.75rem] font-normal leading-tight tracking-[-0.01em] text-sl-text">Build on the platform</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg"><Link href="/developers/quickstart">Start building</Link></Button>
            <Button asChild variant="secondary" size="lg"><Link href="/pricing">See pricing</Link></Button>
          </div>
        </div>
      </section>
    </>
  );
}
