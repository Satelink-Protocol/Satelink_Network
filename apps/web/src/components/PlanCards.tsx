// Plan cards rendered from the PlanCatalog (Pricing V2). Plain words first —
// "about N market-data requests a week" — with UU as the precise unit.
import { Check } from "lucide-react";
import { CONSOLE, type PublicCatalog } from "@/lib/plan-catalog";

export function PlanCards({ catalog }: { catalog: PublicCatalog }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="plan-cards">
      {catalog.plans.map((p) => {
        const featured = p.id === "launch";
        const href = p.kind === "free" ? `${CONSOLE}/sign-in?mode=signup` : `${CONSOLE}/sign-in?mode=signup&next=${encodeURIComponent("/billing/add")}`;
        return (
          <article key={p.id} data-plan={p.id} className={`flex min-w-0 flex-col rounded-[var(--sl-radius-lg)] border bg-sl-surface p-6 ${featured ? "border-sl-accent" : "border-sl-border"}`}>
            <h3 className="flex items-center justify-between text-[15px] font-medium text-sl-text">
              {p.name}
              {featured && <span className="rounded-full bg-sl-accent-soft px-2 py-0.5 text-[11px] font-medium text-sl-accent">Start here</span>}
            </h3>
            <p className="mt-4 font-sl-display text-[2.5rem] leading-none text-sl-text">
              {p.kind === "free" ? "$0" : `$${p.intro ? p.intro.amountUsd : p.priceUsd}`}
              <span className="ml-1 font-sl-sans text-[14px] text-sl-text-muted">{p.kind === "free" ? "forever" : p.intro ? "first month" : "/month"}</span>
            </p>
            <p className="mt-2 min-h-[2.5rem] text-[13px] text-sl-text-muted">{p.intro ? p.intro.copy : p.kind === "free" ? "Try it with no card." : "Billed monthly. Cancel any time."}</p>
            <ul className="mt-5 flex-1 space-y-2 text-[14px] text-sl-text">
              <li className="flex gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sl-accent" />About {p.allowance.weeklyTiRequests.toLocaleString("en-US")} market-data requests a week</li>
              <li className="flex gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sl-accent" />Up to {p.allowance.sessionTiRequests.toLocaleString("en-US")} in any {p.allowance.sessionHours} hours</li>
              <li className="flex gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-sl-accent" />{p.limits.api_keys} API key{p.limits.api_keys > 1 ? "s" : ""} · usage caps per agent</li>
            </ul>
            <p className="mt-4 text-[12px] text-sl-text-subtle">{p.allowance.weeklyUu.toLocaleString("en-US")} UU / week · {p.allowance.sessionUu.toLocaleString("en-US")} UU per {p.allowance.sessionHours} h</p>
            {p.kind === "free" || p.purchasable ? (
              <a href={href} className={`mt-5 inline-flex h-11 items-center justify-center rounded-[var(--sl-radius)] text-[15px] font-medium ${featured ? "bg-sl-accent text-sl-accent-ink hover:bg-sl-accent-strong" : "border border-sl-border-strong text-sl-text hover:bg-sl-surface-hover"}`}>
                {p.kind === "free" ? "Start free" : `Choose ${p.name}`}
              </a>
            ) : (
              <p className="mt-5 inline-flex h-11 items-center justify-center rounded-[var(--sl-radius)] border border-dashed border-sl-border text-[14px] text-sl-text-muted">Opening soon</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
