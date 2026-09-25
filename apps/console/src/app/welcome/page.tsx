import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { accountsEnabled } from "@/lib/account";
import { loadCatalog } from "@/lib/v2";
import { loadOnboarding, onboardingEnabled } from "@/lib/onboarding-server";
import { Onboarding } from "@/components/v2/Onboarding";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/welcome");
  if (!accountsEnabled() || !onboardingEnabled()) redirect("/");
  const [ob, catalog, sp, h] = await Promise.all([loadOnboarding(), loadCatalog(), searchParams, headers()]);
  if (ob.ok && ob.data.step === "done") redirect(ob.data.firstTask && ob.data.firstTask !== "explore" ? `/?task=${ob.data.firstTask}` : "/");
  // Country from Vercel's edge (not client-settable in production).
  const country = (h.get("x-vercel-ip-country") || "").toUpperCase() || null;
  return (
    <div className="min-h-screen bg-sl-bg px-4 pb-16 pt-6 sm:pt-10">
      <p className="mx-auto flex max-w-3xl items-center gap-2 font-semibold tracking-tight text-sl-text">
        <span aria-hidden className="inline-block size-2.5 rounded-sm bg-sl-accent" /> Satelink <span className="font-normal text-sl-text-subtle">Console</span>
      </p>
      <main className="mx-auto mt-6 max-w-3xl">
        {ob.ok ? (
          <Onboarding initial={ob.data} catalog={catalog} country={country} returned={sp.checkout === "done"} />
        ) : (
          <section role="alert" className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6">
            <h1 className="font-sl-display text-2xl text-sl-text">We couldn&apos;t load your setup</h1>
            <p className="mt-2 text-[15px] text-sl-text-muted">Your progress is saved on our side. Refresh in a moment to carry on where you left off.</p>
          </section>
        )}
      </main>
    </div>
  );
}
