"use server";
// Stage 25 — server actions for trading mutations. They run on the console server only; the
// Idempotency-Key comes from the rendered form (a double submit replays, never duplicates).
import { redirect } from "next/navigation";
import { agentIaEnabled } from "@/lib/trading/flags";
import { tradingPost } from "@/lib/trading/client";

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, params: Record<string, string>) => redirect(`${path}?${new URLSearchParams(params).toString()}`);

function keyOf(f: FormData): string {
  const k = str(f, "idempotencyKey");
  if (!KEY_RE.test(k)) throw new Error("bad form");
  return k;
}

export async function placePaperOrder(f: FormData) {
  if (!agentIaEnabled()) redirect("/");
  if (f.get("understand") !== "yes") back("/trading/orders", { error: "confirm" });
  const body = {
    brokerAccountId: str(f, "brokerAccountId"), mandateId: str(f, "mandateId"), mode: "paper", venue: str(f, "venue"),
    instrument: str(f, "instrument"), side: str(f, "side"), type: "limit", timeInForce: "gtc", quantity: str(f, "quantity"), limitPrice: str(f, "limitPrice"),
  };
  const r = await tradingPost<{ orderId: string }>("/orders", body, { idempotencyKey: keyOf(f) });
  if (!r.ok) back("/trading/orders", { error: r.code ?? String(r.status), message: (r.message ?? "").slice(0, 200) });
  redirect(`/trading/orders/${encodeURIComponent((r as { data: { orderId: string } }).data.orderId)}?placed=1`);
}

export async function requestCancel(f: FormData) {
  if (!agentIaEnabled()) redirect("/");
  const orderId = str(f, "orderId");
  const r = await tradingPost(`/orders/${encodeURIComponent(orderId)}/cancel`, {}, { idempotencyKey: keyOf(f) });
  back(`/trading/orders/${encodeURIComponent(orderId)}`, r.ok ? { cancel: "requested" } : { error: r.code ?? String(r.status) });
}

export async function engageStop(f: FormData) {
  if (!agentIaEnabled()) redirect("/");
  const r = await tradingPost("/kill-switch/engage", { scopeType: "principal", reason: str(f, "reason") || "Paused from the console" }, { idempotencyKey: keyOf(f) });
  back("/trading/risk", r.ok ? { done: "paused" } : { error: r.code ?? String(r.status) });
}

export async function releaseStop(f: FormData) {
  if (!agentIaEnabled()) redirect("/");
  const code = str(f, "code");
  if (!/^\d{6}$/.test(code)) back("/trading/risk", { error: "STEP_UP_REQUIRED" });
  const r = await tradingPost("/kill-switch/release", { scopeType: "principal", reason: str(f, "reason") || "Resumed from the console" }, { idempotencyKey: keyOf(f), stepUp: code });
  back("/trading/risk", r.ok ? { done: "resumed" } : { error: r.code ?? String(r.status) });
}
