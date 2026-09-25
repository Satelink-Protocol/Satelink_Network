// Block renderers + dispatcher (§8/§16). CMS page bodies are a `blocks` array;
// BlockRenderer maps each block's `blockType` to a presentational renderer.
// Blocks with no content render nothing (auto-hide). Prop types are structural
// (they mirror the apps/cms block field shapes) so web-ui stays decoupled.
import * as React from "react";
import Link from "next/link";
import { Card, CardTitle, CardDescription } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Disclosure } from "../components/ui/Disclosure";
import { CodeBlock } from "../components/ui/CodeBlock";
import { SectionHeader } from "../components/ui/SectionHeader";
import { ComparisonTable, type Cell } from "../components/ui/ComparisonTable";
import { LifecycleStepper } from "./LifecycleStepper";

type Cta = { label: string; href: string };

export type Block =
  | { blockType: "hero"; eyebrow?: string; heading: string; definition?: string; ctas?: Cta[] }
  | { blockType: "richText"; html?: string; text?: string }
  | { blockType: "valueCards"; cards: { title: string; body: string }[] }
  | { blockType: "code"; illustrative?: boolean; tabs: { language: string; code: string }[] }
  | { blockType: "apiExample"; endpoint?: string; illustrative?: boolean; request?: string; response?: string }
  | { blockType: "faq"; group?: string; items: { question: string; answer: string }[] }
  | { blockType: "cta"; heading?: string; label?: string; href?: string }
  | { blockType: "callout"; tone?: "info" | "warn" | "success"; body: string }
  | { blockType: "pricingLive"; productSlug?: string; prices?: { metric: string; price: number; unit: string; currency?: string }[] }
  | { blockType: "lifecycleStepper"; note?: string }
  | { blockType: "machineReadablePanel"; productSlug?: string; json?: unknown }
  | { blockType: "comparisonTable"; columns?: string[]; rows: { label: string; values: (string | boolean)[] }[] }
  | { blockType: "relatedContent"; heading?: string; items?: { label: string; href: string }[] };

const Illustrative = () => (
  <span className="ml-2 rounded bg-sl-warn/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sl-warn">Illustrative</span>
);

const Section = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`mx-auto max-w-[1100px] px-4 py-10 sm:px-6 ${className}`}>{children}</section>
);

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b, i) => <BlockOne key={i} block={b} />)}</>;
}

function BlockOne({ block: b }: { block: Block }) {
  switch (b.blockType) {
    case "hero":
      return (
        <Section className="pt-16 text-center">
          {b.eyebrow && <p className="font-sl-mono text-sm text-sl-accent">{b.eyebrow}</p>}
          <h1 className="mx-auto mt-3 max-w-[20ch] text-4xl font-bold tracking-tight text-sl-text sm:text-5xl">{b.heading}</h1>
          {b.definition && <p className="mx-auto mt-5 max-w-[60ch] text-lg text-sl-text-muted">{b.definition}</p>}
          {b.ctas?.length ? (
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {b.ctas.map((c, i) => (
                <Button key={c.href} asChild variant={i === 0 ? "primary" : "secondary"} size="lg"><Link href={c.href}>{c.label}</Link></Button>
              ))}
            </div>
          ) : null}
        </Section>
      );
    case "richText":
      return <Section><div className="prose-sl mx-auto max-w-[68ch] text-sl-text-muted" dangerouslySetInnerHTML={b.html ? { __html: b.html } : undefined}>{b.html ? undefined : b.text}</div></Section>;
    case "valueCards":
      if (!b.cards?.length) return null;
      return (
        <Section>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {b.cards.map((c) => (
              <Card key={c.title}><CardTitle>{c.title}</CardTitle><CardDescription>{c.body}</CardDescription></Card>
            ))}
          </div>
        </Section>
      );
    case "code":
      if (!b.tabs?.length) return null;
      return (
        <Section>
          {b.illustrative && <p className="mb-2 text-right text-xs text-sl-text-subtle">Example<Illustrative /></p>}
          <CodeBlock tabs={b.tabs.map((t) => ({ label: t.language, code: t.code }))} />
        </Section>
      );
    case "apiExample":
      return (
        <Section>
          <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
            <p className="flex items-center font-sl-mono text-xs text-sl-text-subtle">{b.endpoint}{b.illustrative && <Illustrative />}</p>
            {b.request && <CodeBlock code={b.request} ariaLabel="Request" className="mt-3" />}
            {b.response && <CodeBlock code={b.response} ariaLabel="Response" className="mt-3" />}
          </div>
        </Section>
      );
    case "faq":
      if (!b.items?.length) return null;
      return (
        <Section>
          {b.group && <SectionHeader title={b.group} align="left" />}
          <div className="mt-4 space-y-3">
            {b.items.map((it) => <Disclosure key={it.question} title={it.question}>{it.answer}</Disclosure>)}
          </div>
        </Section>
      );
    case "cta":
      return (
        <Section className="text-center">
          {b.heading && <h2 className="font-sl-display text-[1.75rem] font-normal leading-tight tracking-[-0.01em] text-sl-text">{b.heading}</h2>}
          {b.label && b.href && <div className="mt-5"><Button asChild variant="primary" size="lg"><Link href={b.href}>{b.label}</Link></Button></div>}
        </Section>
      );
    case "callout": {
      const tone = b.tone ?? "info";
      const toneClass = tone === "warn" ? "border-sl-warn/40 bg-sl-warn/10" : tone === "success" ? "border-sl-up/40 bg-sl-up/10" : "border-sl-accent/40 bg-sl-accent/10";
      return <Section><div className={`rounded-[var(--sl-radius)] border p-4 text-sm text-sl-text-muted ${toneClass}`}>{b.body}</div></Section>;
    }
    case "pricingLive":
      return (
        <Section>
          <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Live pricing{b.productSlug ? ` — ${b.productSlug}` : ""}</p>
            <ul className="mt-3 space-y-1.5 font-sl-mono text-sm text-sl-text-muted">
              {(b.prices ?? []).map((p) => (
                <li key={p.metric} className="flex justify-between"><span>{p.metric}</span><span className="tabular-nums text-sl-text">${p.price} / {p.unit}</span></li>
              ))}
              {!b.prices?.length && <li className="text-sl-text-subtle">Prices read from the live catalog at render.</li>}
            </ul>
          </div>
        </Section>
      );
    case "lifecycleStepper":
      return <LifecycleStepper />;
    case "machineReadablePanel":
      return (
        <Section>
          <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">For machines</p>
            <pre tabIndex={0} className="mt-3 overflow-x-auto font-sl-mono text-xs text-sl-text-muted"><code>{JSON.stringify(b.json ?? { product: b.productSlug, docs: "/products/" + b.productSlug + ".json" }, null, 2)}</code></pre>
          </div>
        </Section>
      );
    case "comparisonTable":
      if (!b.rows?.length) return null;
      return (
        <Section>
          <ComparisonTable
            columns={b.columns ?? []}
            rows={b.rows.map((r) => ({ label: r.label, cells: r.values as Cell[] }))}
          />
        </Section>
      );
    case "relatedContent":
      if (!b.items?.length) return null;
      return (
        <Section>
          <SectionHeader title={b.heading ?? "Related"} align="left" />
          <div className="mt-4 flex flex-wrap gap-3">
            {b.items.map((it) => (
              <Link key={it.href} href={it.href} className="rounded-[var(--sl-radius-sm)] border border-sl-border px-3 py-2 text-sm text-sl-text-muted transition-colors hover:border-sl-accent hover:text-sl-text">{it.label}</Link>
            ))}
          </div>
        </Section>
      );
    default:
      return null;
  }
}
