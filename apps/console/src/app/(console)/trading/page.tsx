import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Kpi, PageHeader, Panel } from "@/components/ui";
import { ApiState, ModeBadge, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";

export const metadata: Metadata = { title: "Home" };

type Stop = { scopeType: string; scopeId: string | null; reason: string };
type Position = { instrument: string; mode: string; quantity: string };

export default async function TradingHome() {
  requireAgentIa();
  const [status, stops, positions] = await Promise.all([
    tradingGet<{ flags: Record<string, { enabled: boolean }>; mcp: boolean }>("/status"),
    tradingGet<Stop[]>("/kill-switch"),
    tradingGet<Position[]>("/positions"),
  ]);
  if (!status.ok) {
    return (<><PageHeader title="Home" lede="Your Trading Agent at a glance." /><ApiState status={status.status} code={status.code} what="agent status" /><TradingDisclosure /></>);
  }
  const live = status.data.flags?.LIVE_TRADING?.enabled === true;
  const open = positions.ok ? positions.data.filter((p) => p.quantity !== "0") : null;
  return (
    <>
      <PageHeader title="Home" lede="Your Trading Agent at a glance." actions={<ModeBadge mode={live ? "live" : "paper"} />} />
      {!live && <p className="mb-3 text-sl-text-muted">Live trading is off. Everything here is <strong>paper trading</strong>: simulated orders, no real money.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Trading" value={stops.ok ? (stops.data.length ? "Paused" : "Running") : null} hint={stops.ok ? (stops.data.length ? `${stops.data.length} stop(s) on` : "No stop is on") : "Couldn't load stops"} />
        <Kpi label="Open paper positions" value={open ? String(open.length) : null} hint={open ? "Simulated" : "Couldn't load positions"} />
        <Kpi label="Agent tools for other apps" value={status.data.mcp ? "On" : "Off"} hint="Read and propose only — never places orders" />
      </div>
      <Panel title="What you can do" className="mt-4">
        <ul className="grid gap-2 sm:grid-cols-2">
          <li><Link className="text-sl-accent underline" href="/trading/orders">Place a paper order</Link> <Badge tone="settle">simulated</Badge></li>
          <li><Link className="text-sl-accent underline" href="/trading/risk">Pause all trading</Link></li>
          <li><Link className="text-sl-accent underline" href="/trading/agent">See what the agent proposes</Link></li>
          <li><Link className="text-sl-accent underline" href="/trading-intelligence">Look at markets</Link></li>
        </ul>
      </Panel>
      <TradingDisclosure />
    </>
  );
}
