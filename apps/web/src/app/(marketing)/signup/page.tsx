// /signup — entry page (§8). Auth lives in the existing console (do not rebuild
// it): this page routes people to the right starting point. Cards: create a
// console account, keyless API/machine access (x402, no account), docs, pricing.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { SITES } from "@satelink/content";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";

export const metadata: Metadata = buildMetadata({
  title: "Get started",
  description: "Start with Satelink: create a developer console account, or skip signup entirely and pay per call keylessly with x402.",
  path: "/signup",
});

const CARDS = [
  { title: "Developer console", body: "Create an account, issue API keys, and fund a balance.", href: "/satelink/os/mission-control", cta: "Open the console" },
  { title: "API / machine access", body: "No account needed — pay per call keylessly with x402.", href: "/products/x402", cta: "Use x402" },
  { title: "Quickstart", body: "From discovery to your first paid call in minutes.", href: "/developers/quickstart", cta: "Start building" },
  { title: "Docs", body: "The full API reference and guides.", href: SITES.docs.origin, cta: "Read the docs" },
];

export default function SignupPage() {
  return (
    <>
      <section className="mx-auto max-w-[1000px] px-4 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Get started</p>
        <h1 className="mx-auto mt-3 max-w-[22ch] text-balance text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">Pick how you want to start.</h1>
        <p className="mx-auto mt-5 max-w-[56ch] text-lg text-sl-text-muted">
          Create a console account to manage keys and balances, or skip signup entirely and pay per
          call with x402.
        </p>
        <p className="mt-4 text-sm text-sl-text-muted">
          Already have an account? <Link href="/login" className="text-sl-accent underline">Log in</Link>.
        </p>
      </section>
      <section className="mx-auto max-w-[1000px] px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {CARDS.map((c) => (
            <Card key={c.title} interactive className="flex flex-col">
              <CardTitle>{c.title}</CardTitle>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{c.body}</p>
              <Link href={c.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">{c.cta} <ArrowRight className="size-3.5" /></Link>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
