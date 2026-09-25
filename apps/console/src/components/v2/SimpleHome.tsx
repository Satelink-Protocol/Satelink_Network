import Link from "next/link";
import { ArrowRight, Bot, LineChart, PlusCircle, Wallet } from "lucide-react";
import type { AccountPlan, PlanCatalog } from "@/lib/v2";
import { Meter } from "./charts";

const CARDS = [
  { href: "/data", icon: LineChart, title: "Get market data", body: "Funding rates, open interest, order books — pick a market, see the price, get a chart." },
  { href: "/agents/new", icon: Bot, title: "Give my software access", body: "Create a key for an app or agent, choose what it can use and set a monthly limit." },
  { href: "/billing/add", icon: PlusCircle, title: "Add money", body: "Choose a plan or a credit pack, or top up with USDT." },
  { href: "/spend", icon: Wallet, title: "See what I've spent", body: "This month, per agent, what's left and when it resets." },
];

export function SimpleHome({ name, plan, catalog }: { name: string; plan: AccountPlan | null; catalog: PlanCatalog | null }) {
  const planName = plan ? catalog?.plans.find((p) => p.id === plan.plan.id)?.name ?? plan.plan.id : null;
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[15px] text-sl-text-muted">Hi{name ? ` ${name.split(" ")[0]}` : ""}.</p>
      <h1 className="mt-1 font-sl-display text-[2.25rem] font-normal leading-tight tracking-[-0.015em] text-sl-text">What do you want to do?</h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="group flex h-full flex-col rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 transition-colors hover:border-sl-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45">
              <c.icon aria-hidden className="size-6 text-sl-accent" />
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
