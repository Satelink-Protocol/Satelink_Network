import Link from "next/link";
import { ArrowRight, Blocks, Bot, LineChart, PlusCircle, Wallet } from "lucide-react";
import type { AccountPlan, PlanCatalog } from "@/lib/v2";
import { TASKS } from "@/lib/onboarding";
import { Meter } from "./charts";

const ICONS = { "market-data": LineChart, "agent-access": Bot, "add-money": PlusCircle, spend: Wallet, rpc: Blocks } as const;
const DEFAULT_ORDER = ["market-data", "agent-access", "add-money", "spend"];

/** Cards: the use case's suggested tasks first (from onboarding), then the rest. */
function cardOrder(suggested: string[]) {
  const first = suggested.filter((t) => t in TASKS);
  const rest = DEFAULT_ORDER.filter((t) => !first.includes(t));
  return [...first, ...rest];
}

export function SimpleHome({ name, plan, catalog, suggested = [], highlight = null }: { name: string; plan: AccountPlan | null; catalog: PlanCatalog | null; suggested?: string[]; highlight?: string | null }) {
  const planName = plan ? catalog?.plans.find((p) => p.id === plan.plan.id)?.name ?? plan.plan.id : null;
  const CARDS = cardOrder(suggested).map((id) => ({ id, ...TASKS[id], icon: ICONS[id as keyof typeof ICONS] }));
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[15px] text-sl-text-muted">Hi{name ? ` ${name.split(" ")[0]}` : ""}.</p>
      <h1 className="mt-1 font-sl-display text-[2.25rem] font-normal leading-tight tracking-[-0.015em] text-sl-text">What do you want to do?</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <li key={c.href}>
            <Link href={c.href} aria-describedby={c.id === highlight ? "first-step" : undefined} className={`group flex h-full flex-col rounded-[var(--sl-radius-lg)] border bg-sl-surface p-5 transition-colors hover:border-sl-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 ${c.id === highlight ? "border-sl-accent ring-1 ring-sl-accent" : "border-sl-border"}`}>
              <span className="flex items-start justify-between gap-2">
                <c.icon aria-hidden className="size-6 text-sl-accent" />
                {c.id === highlight && <span id="first-step" className="rounded-full bg-sl-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-sl-accent">Your first step</span>}
              </span>
              <span className="mt-4 text-[17px] font-medium text-sl-text">{c.title}</span>
              <span className="mt-1 flex-1 text-[14px] leading-snug text-sl-text-muted">{c.body}</span>
              <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-sl-accent">Start <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          </li>
        ))}
      </ul>
      {plan && (
        <section aria-label="Your plan" className="mt-6 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
          <p className="text-[13px] text-sl-text-muted">Your plan: <span className="text-sl-text">{planName}</span>{plan.plan.status === "on_hold" && <span className="ml-2 text-sl-warn">payment on hold</span>}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Meter label="This session" used={plan.windows.session.usedUu} cap={plan.windows.session.capUu} hint={`Refills over a rolling ${plan.windows.session.hours} hours.`} />
            <Meter label="This week" used={plan.windows.weekly.usedUu} cap={plan.windows.weekly.capUu} hint={`Resets ${new Date(plan.windows.weekly.resetsAt).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}.`} />
          </div>
        </section>
      )}
    </div>
  );
}
