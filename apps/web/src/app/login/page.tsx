// /login — customer sign-in (web-v3 P5). Signal-styled, standalone (no marketing
// chrome). Redesigned from the old "admin access" page: it now presents Google/
// email sign-in via the shared AuthPanel while preserving the working
// email/password → /auth/login flow, so the operator/builder/distributor
// consoles are unaffected. Operators sign in at /ops/login.
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AuthPanel } from "@/components/AuthPanel";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-sl-bg px-4 py-12">
      <div className="sl-grad-hero pointer-events-none absolute inset-0" aria-hidden />
      <Link href="/" className="relative mb-8 font-sl-display text-lg font-normal tracking-tight text-sl-text">
        Satelink
      </Link>
      <div className="relative">
        <Suspense fallback={<div className="h-96 w-full max-w-md rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface" />}>
          <AuthPanel mode="signin" />
        </Suspense>
      </div>
    </div>
  );
}
