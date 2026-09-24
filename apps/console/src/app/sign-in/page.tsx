import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getSession()) redirect(safeNext);
  return (
    <div data-theme="dark" className="flex min-h-screen items-center justify-center bg-sl-bg px-4">
      <div className="w-full max-w-sm">
        <p className="flex items-center gap-2 font-semibold tracking-tight text-sl-text">
          <span aria-hidden className="inline-block size-2.5 rounded-sm bg-sl-accent" /> Satelink <span className="font-normal text-sl-text-subtle">Console</span>
        </p>
        <h1 className="mt-6 text-xl font-semibold text-sl-text">Sign in</h1>
        <p className="mt-1 text-sl-text-muted">New here? Signing in creates your account.</p>
        <div className="mt-6"><SignInForm next={safeNext} /></div>
        <p className="mt-8 text-[11px] text-sl-text-subtle">
          By continuing you agree to the <a className="underline" href="https://satelink.network/terms">Terms</a> and <a className="underline" href="https://satelink.network/privacy">Privacy policy</a>.
        </p>
      </div>
    </div>
  );
}
