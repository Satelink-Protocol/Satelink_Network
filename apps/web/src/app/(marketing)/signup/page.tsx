// /signup — customer sign-up (web-v3 P5). Google/Apple/email sign-up with a
// DPDP-style consent notice via the shared AuthPanel. New-account creation
// requires the Better Auth backend (Track B); until NEXT_PUBLIC_AUTH_ENABLED is
// on, the form shows a "rolling out — notify me" state and the other real ways
// to start (keyless x402, the console, docs) remain actionable. No dead controls.
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildMetadata } from "@satelink/seo";
import { SITES } from "@satelink/content";
import { AuthPanel } from "@/components/AuthPanel";
import { Card, CardTitle } from "@/components/ui/Card";

export const metadata: Metadata = buildMetadata({
  title: "Get started",
  description:
    "Create a Satelink account to start Free with 300 Trading-Intelligence calls a month — or skip signup and pay per call keylessly with x402.",
  path: "/signup",
});

const OTHER_WAYS = [
  { title: "Keyless x402", body: "No account needed — pay per call in USDC on Base.", href: "/products/x402", cta: "Use x402" },
  { title: "Quickstart", body: "From discovery to your first paid call in minutes.", href: "/developers/quickstart", cta: "Start building" },
  { title: "Docs", body: "The full API reference and guides.", href: SITES.docs.origin, cta: "Read the docs" },
];

export default function SignupPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-sl-border">
        <div className="sl-grad-hero pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-[1100px] items-center gap-12 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-accent">Get started</p>
            <h1 className="mt-3 max-w-[18ch] text-balance font-sl-display text-4xl font-extrabold tracking-tight text-sl-text sm:text-5xl">
              Start free in a minute.
            </h1>
            <p className="mt-5 max-w-[52ch] text-lg text-sl-text-muted">
              Create an account to get 300 Trading-Intelligence calls a month, issue an API key, and make
              your first call. No card required.
            </p>
          </div>
          <Suspense fallback={<div className="h-96 w-full max-w-md rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface" />}>
            <AuthPanel mode="signup" />
          </Suspense>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Other ways to start</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {OTHER_WAYS.map((c) => (
            <Card key={c.title} interactive className="flex flex-col">
              <CardTitle className="text-base">{c.title}</CardTitle>
              <p className="mt-2 flex-1 text-sm text-sl-text-muted">{c.body}</p>
              <Link href={c.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
                {c.cta} <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
