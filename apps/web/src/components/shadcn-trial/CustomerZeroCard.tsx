"use client";

/**
 * shadcn/ui TRIAL — Customer Zero Countdown rebuilt with shadcn Card + Chart.
 *
 * Side-by-side trial only: this is the single panel migrated to shadcn. Every
 * other panel still uses satelink-os. The whole tree is wrapped in
 * `.theme-shadcn` so shadcn's Slate tokens apply WITHOUT leaking into the
 * satelink :root theme (see globals.css). Data is real, from /admin/intel/developers.
 */

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface CustomerZeroLead {
  ip: string;
  avg_daily_calls?: number;
  days_active?: number;
  status?: string;
}

const chartConfig = {
  calls: { label: "Calls/day", color: "var(--chart-1)" },
} satisfies ChartConfig;

const fmtNum = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

/** Top-3 demand leads as a shadcn Card with a filled AreaChart. */
export function CustomerZeroCard({
  leads,
  czHit,
}: {
  leads: CustomerZeroLead[] | null;
  czHit: boolean;
}): JSX.Element {
  const data = (leads ?? []).map((l) => ({
    lead: String(l.ip ?? "").split(".").pop() || "?",
    calls: l.avg_daily_calls ?? 0,
  }));
  const top = (leads ?? [])[0];

  return (
    <div className="theme-shadcn">
      <Card>
        <CardHeader>
          <CardTitle>Customer Zero Countdown</CardTitle>
          <CardDescription>Top 3 leads by demand · avg calls/day</CardDescription>
          <CardAction>
            <Badge variant={czHit ? "default" : "secondary"}>{czHit ? "HIT" : "WAITING"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <p className="text-muted-foreground text-sm">No leads classified yet.</p>
          ) : (
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <AreaChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="lead" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                <defs>
                  <linearGradient id="fillCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-calls)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-calls)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <Area
                  dataKey="calls"
                  type="monotone"
                  fill="url(#fillCalls)"
                  stroke="var(--color-calls)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
        {top ? (
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-xs">
              #1 candidate{" "}
              <span className="text-foreground font-medium">{top.ip}</span> ·{" "}
              {fmtNum(top.avg_daily_calls ?? 0)} calls/day · {top.days_active ?? 0}d active.
              Live trend available after RPC metrics pipeline.
            </p>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
