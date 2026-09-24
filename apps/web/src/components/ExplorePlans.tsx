"use client";
// ExplorePlans — the shared plan cards used on the home "Explore plans" section
// and (P3) the /pricing page. Config-driven from lib/plans.ts. Respects the
// PLANS_ENABLED flag: until plans are live in the backend, Pro/Max render a
// "notify me" link to the enquiry form (never a buy button that can't complete);
// Free links to signup; the Agents & API card links to the rate card.
import * as React from "react";
import { PriceCard } from "@/components/ui/PriceCard";
import { PLANS, plansEnabled, yearlySavingPct, type BillingPeriod } from "@/lib/plans";

export function ExplorePlans({
  showToggle = true,
  compareHref = "/pricing#compare",
}: {
  showToggle?: boolean;
  compareHref?: string | null;
}) {
  const [period, setPeriod] = React.useState<BillingPeriod>("monthly");
  const enabled = plansEnabled();

  return (
    <div>
      {showToggle && (
        <div className="mx-auto mb-8 flex w-fit items-center gap-1 rounded-[var(--sl-radius-pill)] border border-sl-border bg-sl-surface p-1">
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className="rounded-[var(--sl-radius-pill)] px-4 py-1.5 text-sm font-semibold capitalize text-sl-text-muted transition-colors aria-pressed:bg-sl-accent aria-pressed:text-sl-accent-ink"
            >
              {p}
              {p === "yearly" && <span className="ml-1.5 text-xs font-normal opacity-80">save ~17%</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const isFree = plan.id === "free";
          const price = isFree ? "$0" : `$${plan.price[period]}`;
          const periodLabel = isFree ? "forever" : period === "monthly" ? "/month" : "/year";
          const saving = period === "yearly" ? yearlySavingPct(plan) : 0;

          let cta: { label: string; href?: string; disabled?: boolean };
          if (isFree) {
            cta = { label: "Start free", href: "/signup" };
          } else if (enabled) {
            cta = { label: `Choose ${plan.name}`, href: `/checkout?plan=${plan.id}` };
          } else {
            // Not live yet — capture interest via the enquiry form.
            cta = { label: "Available soon — notify me", href: "/contact-sales?topic=plans" };
          }

          return (
            <PriceCard
              key={plan.id}
              tier={plan.name}
              price={price}
              period={periodLabel}
              blurb={plan.tagline}
              features={plan.features}
              featured={plan.featured}
              cta={cta}
              note={!isFree && saving > 0 ? `Save ~${saving}% billed yearly` : undefined}
            />
          );
        })}

        {/* Agents & API — pay per call (no plan) */}
        <PriceCard
          tier="Agents & API"
          price="Pay per call"
          blurb="For machines and agents. No plan, no commitment."
          features={[
            "Trading Intelligence — $0.01 / call",
            "Polygon RPC — $0.00003 / call",
            "x402 (keyless) or prepaid credits",
            "Public discovery + machine-readable pricing",
          ]}
          cta={{ label: "See the rate card", href: "/pricing#agents" }}
          note="Crypto rail (x402/USDT) — not billed through Dodo"
        />
      </div>

      {compareHref && (
        <p className="mt-6 text-center text-sm text-sl-text-muted">
          <a href={compareHref} className="font-semibold text-sl-accent hover:text-sl-accent-strong">
            Compare plans →
          </a>
        </p>
      )}
    </div>
  );
}
