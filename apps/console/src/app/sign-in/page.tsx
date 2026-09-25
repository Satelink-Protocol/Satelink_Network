import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@satelink/web-ui/site/Wordmark";
import { getSession } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

const WEB = "https://satelink.network";

// claude.ai/login pattern: one calm centred column — wordmark, one serif
// headline, Continue with Google, email + magic link, legal line. Follows the
// console theme (no forced palette — AUDIT_2026-09-25 D11). `?mode=signup`
// only changes the words: Better Auth creates the account on first sign-in.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const { next, mode } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getSession()) redirect(safeNext);
  const signup = mode === "signup";
  return (
    <main className="flex min-h-screen flex-col bg-sl-bg px-4 text-[14px]">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-16">
        <a href={WEB} className="self-center text-sl-text" aria-label="Satelink home"><Wordmark /></a>
        <h1 className="mt-10 text-balance text-center font-sl-display text-[2.125rem] font-normal leading-[1.1] tracking-[-0.015em] text-sl-text">
          {signup ? "Give your software a way to pay" : "Welcome back"}
        </h1>
        <p className="mt-3 text-center text-[15px] text-sl-text-muted">
          {signup ? "Create your account — keys, usage and billing in one place." : "Sign in to your Satelink console."}
        </p>
        <div className="mt-8"><SignInForm next={safeNext} signup={signup} /></div>
        <p className="mt-6 text-center text-[12px] leading-relaxed text-sl-text-subtle">
          By continuing, you agree to Satelink&apos;s <a className="underline underline-offset-2 hover:text-sl-text" href={`${WEB}/terms`}>Terms</a> and acknowledge the{" "}
          <a className="underline underline-offset-2 hover:text-sl-text" href={`${WEB}/privacy`}>Privacy policy</a>.
        </p>
      </div>
      <p className="mx-auto max-w-[400px] pb-8 text-center text-[13px] text-sl-text-muted">
        Building an agent? It can pay per call with x402 — no account needed.{" "}
        <a className="text-sl-text underline underline-offset-2" href={`${WEB}/products/x402`}>How x402 works</a>
      </p>
    </main>
  );
}
