// Stage 25 — shared trading UI parts (server-renderable; no client state, no secrets).
import { Disclosure } from "@satelink/web-ui/ui/Disclosure";
import { Badge, Empty } from "@/components/ui";
import { apiStateText, modeLabel, orderStateText } from "@/lib/trading/states";

/** Layer 4: every trading page carries the plain "not investment advice" note. */
export function TradingDisclosure() {
  return (
    <Disclosure title="Not investment advice" className="mt-4">
      The Trading Agent follows rules you set and limits you sign. Nothing here is a recommendation to buy or sell,
      and past or simulated results do not predict future results.
    </Disclosure>
  );
}

/** Layer 2: simulated / hypothetical / live is always visible next to numbers. */
export function ModeBadge({ mode }: { mode: string | null | undefined }) {
  const m = modeLabel(mode);
  return <Badge tone={m.tone}>{m.text}</Badge>;
}

/** Layer 3: OMS state as a sentence, with a live-region so screen readers hear changes. */
export function OrderState({ status, venue }: { status: string; venue?: string | null }) {
  const s = orderStateText(status, venue);
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      {s.pending && <span aria-hidden className="inline-block size-2 animate-pulse rounded-full bg-sl-accent" />}
      <Badge tone={s.tone}>{s.text}</Badge>
    </span>
  );
}

/** Layer 1: an API failure renders a designed state — never a number we don't have. */
export function ApiState({ status, code, what }: { status: number; code?: string | null; what: string }) {
  const s = apiStateText(status, code);
  return <Empty title={s.title} body={`${s.body} (${what})`} />;
}
