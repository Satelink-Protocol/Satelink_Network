// Stage 25 — plain-language states (layer 3 of the five-layer rule). Every machine state the
// trading API can return has a sentence a non-expert understands; unknown states say so plainly.
export const VENUE_NAMES: Record<string, string> = { binance: "Binance", upstox: "Upstox", alpaca: "Alpaca", mock: "the simulator" };
export const venueName = (venue: string | null | undefined) => (venue && VENUE_NAMES[venue]) || "the broker";

export type Tone = "neutral" | "good" | "warn" | "machine" | "market" | "settle";

/** OMS order status (Stage 17 DB values) → sentence + tone + whether it is still moving. */
export function orderStateText(status: string, venue?: string | null): { text: string; tone: Tone; pending: boolean } {
  const r = orderStateRaw(status, venueName(venue));
  return { ...r, text: r.text.charAt(0).toUpperCase() + r.text.slice(1) };
}

function orderStateRaw(status: string, v: string): { text: string; tone: Tone; pending: boolean } {
  switch (status) {
    case "approved": return { text: `Approved by your limits — waiting to send to ${v}`, tone: "neutral", pending: true };
    case "submitted": return { text: `Sending to ${v}…`, tone: "machine", pending: true };
    case "unknown": return { text: `Confirming with ${v}… We never send it twice while we check.`, tone: "warn", pending: true };
    case "acknowledged": return { text: `${v} has your order — waiting for a fill`, tone: "machine", pending: true };
    case "partially_filled": return { text: `Partly filled at ${v}`, tone: "market", pending: true };
    case "filled": return { text: "Filled", tone: "good", pending: false };
    case "cancel_requested": return { text: `Cancelling with ${v}…`, tone: "warn", pending: true };
    case "cancelled": return { text: "Cancelled", tone: "neutral", pending: false };
    case "rejected": return { text: `${v} rejected the order`, tone: "warn", pending: false };
    default: return { text: `Status "${status}" — we are checking what this means`, tone: "warn", pending: true };
  }
}

/** Layer 2: anything not live and real says so. */
export function modeLabel(mode: string | null | undefined): { text: string; tone: Tone; simulated: boolean } {
  if (mode === "paper") return { text: "Paper — simulated, no real money", tone: "settle", simulated: true };
  if (mode === "backtest") return { text: "Hypothetical — backtest on past data", tone: "settle", simulated: true };
  if (mode === "live") return { text: "Live — real money", tone: "warn", simulated: false };
  return { text: "Mode unknown — treat as simulated", tone: "settle", simulated: true };
}

/** API failure → what the person should understand (never a raw code alone). */
export function apiStateText(status: number, code?: string | null): { title: string; body: string } {
  if (status === 404 && (!code || code === "NOT_FOUND")) return { title: "Trading Agent isn't switched on yet", body: "Your account doesn't have the Trading Agent yet. Nothing here is live; no orders can be placed." };
  if (status === 501) return { title: "Not available yet", body: "This part of the Trading Agent is still being built. We show nothing rather than made-up numbers." };
  if (status === 401) return { title: "Please sign in again", body: "Your session ended, or this action needs a fresh security code." };
  if (status === 403) return { title: "Not allowed", body: "Your account can't do this here." };
  if (status === 429) return { title: "Slow down a little", body: "Too many requests in a minute. Try again shortly." };
  if (status === 0) return { title: "Can't reach Satelink right now", body: "We couldn't load this. Nothing was changed." };
  return { title: "Something went wrong", body: "We couldn't load this. Nothing was changed." };
}

/** Integer minor units (string) → exact decimal string (no floats). */
export function formatMinor(minor: string | null | undefined, decimals: number | null | undefined): string | null {
  if (minor == null || !/^-?\d+$/.test(String(minor)) || decimals == null) return null;
  const neg = String(minor).startsWith("-");
  const digits = String(minor).replace("-", "").padStart(decimals + 1, "0");
  const int = digits.slice(0, digits.length - decimals) || "0";
  const frac = decimals ? digits.slice(digits.length - decimals) : "";
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

const HOP_NAMES: Record<string, string> = { origin: "who started it", risk: "limit check", mandate: "signed permission", order: "order record", dispatch: "sending", fills: "fills", trace: "linked history", ledger: "account statement" };

/** Stage 19 receipt completeness → a plain sentence (no internal stage names). */
export function receiptText(r: { completeness?: { complete: boolean; missing: string[] } } | null | undefined): { text: string; complete: boolean } {
  if (!r?.completeness) return { text: "We couldn't build the record for this order.", complete: false };
  if (r.completeness.complete) return { text: "Complete — every step from your limits to the broker is on record.", complete: true };
  return { text: `Incomplete — missing: ${r.completeness.missing.map((m) => HOP_NAMES[m] ?? m).join(", ")}.`, complete: false };
}
