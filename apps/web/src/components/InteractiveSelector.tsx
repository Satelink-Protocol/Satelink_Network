"use client";
// The "I'm building X and I need Y" selector (§9 /product/overview). Role × need
// resolves to a product; the panel shows the product, a real request, its live
// price, and a docs link. Pure client interaction over server-supplied data —
// no invented numbers: prices come from the caller (live catalog + documented
// constants). Keyboard-accessible native <select>s + SSR-complete result panel.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type SelectorProduct = {
  slug: string;
  name: string;
  href: string;
  priceLine: string;
  exampleRequest: string;
  docs: string;
};

export type SelectorRole = { id: string; label: string };
export type SelectorNeed = { id: string; label: string; product: string };

export function InteractiveSelector({
  roles,
  needs,
  products,
}: {
  roles: SelectorRole[];
  needs: SelectorNeed[];
  products: Record<string, SelectorProduct>;
}) {
  const [role, setRole] = React.useState(roles[0].id);
  const [need, setNeed] = React.useState(needs[0].id);

  const roleLabel = roles.find((r) => r.id === role)?.label ?? roles[0].label;
  const needMeta = needs.find((n) => n.id === need) ?? needs[0];
  const product = products[needMeta.product];

  return (
    <div className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3 text-lg text-sl-text">
        <span>I&rsquo;m building</span>
        <label className="sr-only" htmlFor="sel-role">What you are building</label>
        <select
          id="sel-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-3 py-1.5 font-medium text-sl-accent focus:border-sl-accent focus:outline-none"
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        <span>and I need</span>
        <label className="sr-only" htmlFor="sel-need">What you need</label>
        <select
          id="sel-need"
          value={need}
          onChange={(e) => setNeed(e.target.value)}
          className="rounded-[var(--sl-radius-sm)] border border-sl-border bg-sl-bg px-3 py-1.5 font-medium text-sl-accent focus:border-sl-accent focus:outline-none"
        >
          {needs.map((n) => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>
        <span>.</span>
      </div>

      {product && (
        <div aria-live="polite" className="mt-8 border-t border-sl-border pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sl-text-subtle">
            For {roleLabel} that needs {needMeta.label.toLowerCase()}, use
          </p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-2xl font-bold tracking-tight text-sl-text">{product.name}</h3>
            <span className="font-sl-mono text-sm text-sl-accent">{product.priceLine}</span>
          </div>
          <pre tabIndex={0} className="mt-4 overflow-x-auto rounded-[var(--sl-radius)] border border-sl-border bg-sl-bg p-4 font-sl-mono text-xs leading-relaxed text-sl-text-muted">
            <code>{product.exampleRequest}</code>
          </pre>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link href={product.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
              {product.name} product page <ArrowRight className="size-3.5" />
            </Link>
            <a href={product.docs} className="inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
              Read the docs <ArrowRight className="size-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
