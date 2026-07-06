/**
 * components/deposit/primitives.tsx
 *
 * Self-contained UI primitives matching the existing satelink-os palette
 * (see satelink-command-center.jsx: canvas #060910, panel #0C1120, teal #4ECDC4,
 * JetBrains Mono for metrics, Inter/Geist Sans for UI copy).
 *
 * If apps/web already has these as shared components (Panel, Button, MetricCard,
 * StatusBadge — referenced in the PR #151 changelog), DELETE this file and import
 * those instead. This file exists so the deposit page works standalone without
 * guessing at unknown import paths.
 */
'use client';

import React from 'react';

// Values resolve against the @satelink/ui theme (.satelink-os scope) at
// runtime — this file no longer owns any color of its own.
export const TOKENS = {
  canvas: 'hsl(var(--background))',
  panel: 'hsl(var(--card))',
  border: 'hsl(var(--border))',
  teal: 'hsl(var(--primary))',
  green: 'hsl(var(--success))',
  amber: 'hsl(var(--warning))',
  red: 'hsl(var(--danger))',
  text: 'hsl(var(--foreground))',
  muted: 'hsl(var(--muted-foreground))',
  mono: "var(--font-mono-numeric, 'JetBrains Mono', monospace)",
  sans: "'Inter', system-ui, sans-serif",
};

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border ${className}`}
      style={{ background: TOKENS.panel, borderColor: TOKENS.border }}
    >
      {title && (
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: TOKENS.border }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: TOKENS.muted, fontFamily: TOKENS.sans }}
          >
            {title}
          </span>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function MetricRow({
  label,
  value,
  hint,
  color = TOKENS.text,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs" style={{ color: TOKENS.muted, fontFamily: TOKENS.sans }}>
        {label}
      </span>
      <div className="text-right">
        <div style={{ color, fontFamily: TOKENS.mono, fontSize: 14, fontWeight: 600 }}>
          {value}
        </div>
        {hint && (
          <div style={{ color: TOKENS.muted, fontFamily: TOKENS.sans, fontSize: 10 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}1A`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — fail silently, button just won't confirm */
        }
      }}
      className="text-[10px] px-2 py-1 rounded border transition-colors"
      style={{
        borderColor: TOKENS.border,
        color: copied ? TOKENS.green : TOKENS.teal,
        fontFamily: TOKENS.mono,
      }}
    >
      {copied ? 'COPIED' : label}
    </button>
  );
}

export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{ width, height, background: TOKENS.border }}
    />
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] px-3 py-2 rounded border"
      style={{ borderColor: `${TOKENS.amber}33`, background: `${TOKENS.amber}0D`, color: TOKENS.amber, fontFamily: TOKENS.sans }}
    >
      {children}
    </div>
  );
}
