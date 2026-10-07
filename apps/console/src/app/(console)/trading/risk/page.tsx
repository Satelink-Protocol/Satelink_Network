import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { Badge, PageHeader, Panel, Table } from "@/components/ui";
import { ApiState, TradingDisclosure } from "@/components/trading/parts";
import { tradingGet } from "@/lib/trading/client";
import { requireAgentIa } from "@/lib/trading/guard";
import { engageStop, releaseStop } from "../actions";

export const metadata: Metadata = { title: "Risk" };

type Policy = { version?: number; currency?: string; maxLeverage?: string; maxOpenPositions?: number; allowedInstruments?: string[]; killSwitch?: boolean };
type Stop = { scopeType: string; scopeId: string | null; reason: string; at?: string };
const MESSAGES: Record<string, string> = {
  paused: "Trading is paused. Open orders are being cancelled.", resumed: "Trading is running again.",
  STEP_UP_REQUIRED: "Enter the 6-digit code from your authenticator app to resume.", STEP_UP_FAILED: "That code didn't work. Try the newest code.",
  CONFLICT: "Nothing to resume — trading isn't paused.", RATE_LIMITED: "Too many tries. Wait a minute.",
};

export default async function RiskPage({ searchParams }: { searchParams?: Promise<{ done?: string; error?: string }> }) {
  requireAgentIa();
  const sp = (searchParams ? await searchParams : undefined) ?? {};
  const [policy, stops] = await Promise.all([tradingGet<Policy>("/risk/policy"), tradingGet<Stop[]>("/kill-switch")]);
  const note = sp.done ? MESSAGES[sp.done] : sp.error ? (MESSAGES[sp.error] ?? "That didn't work. Nothing was changed.") : null;
  const paused = stops.ok && stops.data.length > 0;
  return (
    <>
      <PageHeader title="Risk" lede="Your limits, and the switch that stops everything." />
      {note && <p role="status" className="mb-3 rounded border border-sl-border bg-sl-surface p-2">{note}</p>}
      <Panel title="Stop switch">
        {!stops.ok ? <ApiState status={stops.status} code={stops.code} what="stop switch" /> : (
          <>
            <p className="mb-2">Trading is <Badge tone={paused ? "warn" : "good"}>{paused ? "paused" : "running"}</Badge></p>
            {paused ? (
              <form action={releaseStop} className="grid max-w-sm gap-2">
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label className="grid gap-1">Why are you resuming?<input name="reason" required className="rounded border border-sl-border bg-sl-bg px-2 py-1" /></label>
                <label className="grid gap-1">6-digit code from your authenticator app<input name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" className="rounded border border-sl-border bg-sl-bg px-2 py-1" /></label>
                <button type="submit" className="rounded bg-sl-accent px-3 py-1.5 font-medium text-sl-bg">Resume trading</button>
              </form>
            ) : (
              <form action={engageStop} className="grid max-w-sm gap-2">
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label className="grid gap-1">Reason (optional)<input name="reason" className="rounded border border-sl-border bg-sl-bg px-2 py-1" /></label>
                <button type="submit" className="rounded border border-sl-border px-3 py-1.5 font-medium">Pause all trading</button>
              </form>
            )}
          </>
        )}
      </Panel>
      <Panel title="Your limits" className="mt-4">
        {!policy.ok ? <ApiState status={policy.status} code={policy.code} what="risk limits" /> : (
          <Table head={["Limit", "Value"]}>
            <tr><td>Version</td><td>{policy.data.version ?? "—"}</td></tr>
            <tr><td>Max leverage</td><td>{policy.data.maxLeverage ?? "—"}</td></tr>
            <tr><td>Max open positions</td><td>{policy.data.maxOpenPositions ?? "—"}</td></tr>
            <tr><td>Allowed instruments</td><td>{policy.data.allowedInstruments?.join(", ") || "—"}</td></tr>
          </Table>
        )}
      </Panel>
      <TradingDisclosure />
    </>
  );
}
