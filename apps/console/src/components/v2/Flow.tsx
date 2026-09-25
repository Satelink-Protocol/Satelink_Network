"use client";
// Task-flow chrome: a numbered stepper, one primary button per step, a clear
// Done screen. Plain words; the step titles are the flow's only navigation.
import Link from "next/link";
import { Check } from "lucide-react";

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Progress" className="mb-6 flex flex-wrap items-center gap-2 text-[13px]">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span className={`flex size-6 items-center justify-center rounded-full border text-[12px] ${state === "done" ? "border-sl-accent bg-sl-accent text-sl-accent-ink" : state === "current" ? "border-sl-accent text-sl-text" : "border-sl-border text-sl-text-subtle"}`}>
              {state === "done" ? <Check aria-hidden className="size-3.5" /> : i + 1}
            </span>
            <span className={state === "todo" ? "text-sl-text-subtle" : "text-sl-text"}>{s}</span>
            {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-sl-border" />}
          </li>
        );
      })}
    </ol>
  );
}

export function FlowCard({ title, lede, children }: { title: string; lede?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-2xl rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 sm:p-7">
      <h1 className="font-sl-display text-[1.75rem] font-normal leading-tight tracking-[-0.01em] text-sl-text">{title}</h1>
      {lede && <div className="mt-2 text-[15px] text-sl-text-muted">{lede}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export const primaryBtn = "inline-flex h-11 items-center justify-center gap-2 rounded-[var(--sl-radius)] bg-sl-accent px-5 text-[15px] font-medium text-sl-accent-ink hover:bg-sl-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45 disabled:opacity-50";
export const secondaryBtn = "inline-flex h-11 items-center justify-center gap-2 rounded-[var(--sl-radius)] border border-sl-border-strong bg-sl-surface px-4 text-[15px] text-sl-text hover:bg-sl-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sl-accent/45";
export const field = "h-11 w-full rounded-[var(--sl-radius)] border border-sl-border-strong bg-sl-bg px-3 text-[15px] text-sl-text placeholder:text-sl-text-subtle focus:border-sl-accent focus:outline-none focus:ring-2 focus:ring-sl-accent/30";

export function Choice({ name, value, checked, onChange, title, detail }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; title: string; detail?: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--sl-radius)] border p-3.5 ${checked ? "border-sl-accent bg-sl-accent-soft" : "border-sl-border hover:border-sl-border-strong"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="mt-1 accent-[var(--sl-accent)]" />
      <span>
        <span className="block text-[15px] text-sl-text">{title}</span>
        {detail && <span className="mt-0.5 block text-[13px] text-sl-text-muted">{detail}</span>}
      </span>
    </label>
  );
}

export function Done({ title, body, next }: { title: string; body: React.ReactNode; next: { label: string; href: string }[] }) {
  return (
    <div role="status" className="text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-sl-accent-soft text-sl-accent"><Check aria-hidden className="size-6" /></span>
      <h2 className="mt-4 font-sl-display text-2xl text-sl-text">{title}</h2>
      <div className="mt-2 text-[15px] text-sl-text-muted">{body}</div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {next.map((n, i) => (
          <Link key={n.href} href={n.href} className={i === 0 ? primaryBtn : secondaryBtn}>{n.label}</Link>
        ))}
      </div>
    </div>
  );
}
