import { apiFetch, type ConsoleSummary, type Deposits, type UsageHistory } from "./api";
import { num } from "./format";

export type DayRow = { date: string; calls: number; spent: number };

export async function loadKey(key: string) {
  const [summary, history, deposits] = await Promise.all([
    apiFetch<ConsoleSummary>("/v1/console/summary", { key }),
    apiFetch<UsageHistory>("/api/keys/usage-history", { key }),
    apiFetch<Deposits>("/api/keys/deposits", { key }),
  ]);
  const days: DayRow[] | null = history.ok
    ? history.data.usage
        .map((r) => ({ date: r.date.slice(0, 10), calls: num(r.request_count), spent: num(r.usdt_spent) }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : null;
  return {
    summary: summary.ok ? summary.data.data : null,
    days,
    deposits: deposits.ok ? deposits.data.deposits : null,
  };
}

/** Sum over the last n calendar days (UTC), inclusive of today. */
export function windowSum(days: DayRow[], n: number, field: "calls" | "spent") {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (n - 1));
  const c = cutoff.toISOString().slice(0, 10);
  return days.filter((d) => d.date >= c).reduce((s, d) => s + d[field], 0);
}

/** Dense daily series for the last n days (missing days = 0 calls, which is what they were). */
export function series(days: DayRow[], n: number, field: "calls" | "spent") {
  const map = new Map(days.map((d) => [d.date, d[field]]));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(map.get(d.toISOString().slice(0, 10)) ?? 0);
  }
  return out;
}
