// /platform — the platform hub. Links every /platform/* capability and the
// console. No invented numbers; cards are the real platform surfaces.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { PLATFORM, PLATFORM_ORDER, CONSOLE_MAP } from "@/lib/platform";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = buildMetadata({
  title: "Platform",
  description:
    "The Satelink platform: one REST API, keyless x402 payments, machine identity, metering and credits, on-chain settlement, and the ways to integrate. Everything a machine needs to discover, pay, and settle.",
  path: "/platform",
});

export default function PlatformHub() {
  return (
    <>
      <section className="mx-auto max-w-[1100px] px-4 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Platform</p>
        <h1 className="mx-auto mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">
          Everything a machine needs to transact.
        </h1>
        <p className="mx-auto mt-5 max-w-[60ch] text-lg text-sl-text-muted">
          One API, three payment rails, machine identity, metering, and on-chain settlement — the
          full stack behind Satelink&rsquo;s products.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link href="/developers/quickstart">Start building <ArrowRight className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="lg"><Link href="/platform/api">Explore the API</Link></Button>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_ORDER.map((slug) => {
            const p = PLATFORM[slug];
            return (
              <Card key={slug} interactive className="flex flex-col">
                <CardTitle>{p.name}</CardTitle>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-sl-text-muted">{p.tagline}</p>
                <Link href={p.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                  Learn more <ArrowRight className="size-3.5" />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
          <SectionHeader eyebrow="Console" title="Build · Deploy · Monitor · Manage" align="left" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CONSOLE_MAP.map((c) => (
              <Link key={c.verb} href={c.href} className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-accent">
                <p className="font-semibold text-sl-text">{c.verb}</p>
                <p className="mt-1.5 text-sm text-sl-text-muted">{c.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
