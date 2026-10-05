// Stage 26 — shared parts for the Trading Agent public pages.
import Link from "next/link";
import { Badge, Card, CardDescription, CardTitle, Disclosure, SectionHeader } from "@satelink/web-ui/ui";
import DISCLAIMERS from "@/lib/trading-agent/disclaimers.json";
import { TA_PAGES } from "@/lib/trading-agent/copy";
import { stageLabel, type ConnectorStage } from "@/lib/trading-agent/status";

export function TaFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav aria-label="Trading Agent" className="mb-8 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {TA_PAGES.map((p) => <Link key={p.href} href={p.href} className="text-sl-text-muted hover:text-sl-text">{p.label}</Link>)}
      </nav>
      <p className="mb-6"><Badge variant="planned">{DISCLAIMERS.notAvailable}</Badge></p>
      {children}
      <div className="mt-12 grid gap-3">
        <Disclosure title="Not investment advice">{DISCLAIMERS.notAdvice}</Disclosure>
        <Disclosure title="Independence">{DISCLAIMERS.noAffiliation}</Disclosure>
      </div>
    </div>
  );
}

export function TaHeader({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: string }) {
  return <SectionHeader as="h1" align="left" eyebrow={eyebrow} title={title} lede={lede} className="mb-8" />;
}

export function TaCards({ items }: { items: readonly { title: string; body: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((i) => <Card key={i.title}><CardTitle>{i.title}</CardTitle><CardDescription>{i.body}</CardDescription></Card>)}
    </div>
  );
}

/** Any illustrative number lives here, visibly labelled (the claims lint enforces it). */
export function Hypothetical({ children }: { children: React.ReactNode }) {
  return (
    <figure className="rounded-[var(--sl-radius)] border border-dashed border-sl-border p-4">
      <figcaption className="mb-2"><Badge variant="planned">Hypothetical example — not a real order or result</Badge></figcaption>
      {children}
    </figure>
  );
}

/** RPrC — requires professional review before publication. No legal text is written here. */
export function LegalPlaceholder({ id, title }: { id: string; title: string }) {
  return (
    <section id={id} data-rprc="true" className="rounded-[var(--sl-radius)] border border-sl-border p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sl-text-muted">RPrC — this section requires professional (legal) review before it is published. It is intentionally empty.</p>
    </section>
  );
}

export function StageBadge({ stage }: { stage: ConnectorStage }) {
  const l = stageLabel(stage);
  return <Badge variant={l.available ? "live" : "planned"}>{l.text}</Badge>;
}

export const AI_NOTE = DISCLAIMERS.aiCanBeWrong;
