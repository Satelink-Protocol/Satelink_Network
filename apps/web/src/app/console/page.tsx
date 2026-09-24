// Console Home (web-v3 P6) — balance, spend, calls-by-product, recent requests,
// quick actions, and the first-run onboarding checklist. All figures come from
// real endpoints; until those land (Track B) each widget shows an empty state,
// never "—".
import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, PlayCircle, ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { PageHeader, Panel, KpiTile, ConsoleEmpty } from "./_components";

export const metadata: Metadata = { title: "Home" };

const ONBOARDING = [
  { label: "Verify your email", href: "/console/settings", done: false },
  { label: "Create your first agent key", href: "/console/agents", done: false },
  { label: "Make a free call (copy-paste curl with your key)", href: "/console/docs", done: false },
  { label: "Top up or pick a plan", href: "/console/billing", done: false },
];

const QUICK = [
  { label: "Create an agent key", href: "/console/agents", icon: KeyRound },
  { label: "Try the metric explorer", href: "/console/products/trading-intelligence", icon: PlayCircle },
  { label: "Open the quickstart", href: "/console/docs", icon: ArrowUpRight },
];

export default function ConsoleHome() {
  return (
    <>
      <PageHeader title="Home" lede="Your balance, spend, and recent activity across every product." />

      {/* Onboarding checklist */}
      <Panel title="Get started">
        <ul className="space-y-2">
          {ONBOARDING.map((step) => (
            <li key={step.label}>
              <Link href={step.href} className="flex items-center gap-3 rounded-[var(--sl-radius)] px-2 py-2 hover:bg-sl-surface-hover">
                {step.done ? <CheckCircle2 className="size-5 text-sl-accent" /> : <Circle className="size-5 text-sl-text-subtle" />}
                <span className={`text-sm ${step.done ? "text-sl-text-muted line-through" : "text-sl-text"}`}>{step.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Credit balance" value="$0.00" hint="Prepaid, spent per call" />
        <KpiTile label="Plan allowance" value={null} hint="No plan yet" />
        <KpiTile label="Spent today" value={null} />
        <KpiTile label="Spent this month" value={null} />
      </div>

      {/* Calls by product + recent requests */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Calls by product">
          <ConsoleEmpty title="No calls yet" body="Once you make your first call it will show up here, broken down by product." cta={{ label: "Make your first call", href: "/console/docs" }} />
        </Panel>
        <Panel title="Recent requests">
          <ConsoleEmpty title="Nothing to show" body="Your most recent API requests will appear here with status and latency." />
        </Panel>
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {QUICK.map((q) => (
          <Link key={q.label} href={q.href} className="flex items-center gap-3 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-4 transition-colors hover:border-sl-accent">
            <span className="inline-flex size-9 items-center justify-center rounded-[var(--sl-radius)] bg-sl-accent-soft text-sl-accent"><q.icon className="size-4" /></span>
            <span className="text-sm font-semibold text-sl-text">{q.label}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
