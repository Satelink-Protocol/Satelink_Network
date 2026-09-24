// Satelink Signal 2.0 — original illustration kit (P1 §2.3).
// Pure SVG, themeable via --sl-* tokens (no raster, no stock art). Consistent
// 2px stroke, rounded joins, product colours baked in:
//   machine/agent/402 → --sl-machine (indigo)
//   credit/market     → --sl-market  (amber)
//   receipt/settle    → --sl-settle  (sky)
//   platform accents  → --sl-accent  (teal)
// Every glyph is accessible: pass `title` for a labelled graphic, omit it for a
// decorative one (aria-hidden). Colours can be overridden with `color`/style.
import * as React from "react";

export type GlyphProps = Omit<React.SVGProps<SVGSVGElement>, "title"> & {
  /** Accessible label. Omit for a decorative glyph (aria-hidden). */
  title?: string;
  /** Square pixel size (default 48). */
  size?: number;
};

function Svg({ title, size = 48, children, ...rest }: GlyphProps & { children: React.ReactNode }) {
  const labelled = Boolean(title);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** A machine node — a compute unit on the network (indigo). */
export function MachineNodeGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <rect x="10" y="14" width="28" height="20" rx="4" stroke="var(--sl-machine)" />
      <path d="M18 14V9m12 5V9M18 39v-5m12 5v-5M10 21H5m5 6H5m38-6h-5m5 6h-5" stroke="var(--sl-machine)" />
      <rect x="18" y="22" width="12" height="4" rx="1.5" fill="var(--sl-machine-soft)" stroke="var(--sl-machine)" />
      <circle cx="24" cy="18" r="1.4" fill="var(--sl-accent)" stroke="none" />
    </Svg>
  );
}

/** An autonomous agent — software that acts and pays (indigo). */
export function AgentGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <rect x="13" y="16" width="22" height="18" rx="6" stroke="var(--sl-machine)" />
      <circle cx="20" cy="25" r="2" fill="var(--sl-machine)" stroke="none" />
      <circle cx="28" cy="25" r="2" fill="var(--sl-machine)" stroke="none" />
      <path d="M24 16v-5m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="var(--sl-machine)" />
      <path d="M13 26H9m30 0h-4" stroke="var(--sl-accent)" />
    </Svg>
  );
}

/** A 402 price tag — the machine-readable price (teal). */
export function PriceTag402Glyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path
        d="M25 8H13a5 5 0 0 0-5 5v12l17 17 15-15L25 8Z"
        stroke="var(--sl-accent)"
        fill="var(--sl-accent-soft)"
      />
      <circle cx="17" cy="17" r="2.6" stroke="var(--sl-accent)" />
      <path d="M28 22v8m4-8v8m-4-4h4" stroke="var(--sl-machine)" />
    </Svg>
  );
}

/** A prepaid credit coin (amber). */
export function CreditCoinGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <ellipse cx="24" cy="16" rx="14" ry="6" stroke="var(--sl-market)" />
      <path d="M10 16v10c0 3.3 6.3 6 14 6s14-2.7 14-6V16" stroke="var(--sl-market)" />
      <path d="M10 21c0 3.3 6.3 6 14 6s14-2.7 14-6" stroke="var(--sl-market)" opacity=".6" />
      <path d="M24 12v8m-3-6.5c1-1 5-1 6 0-1-1-5-1-6 2.5 1 3.5 5 3.5 6 2.5" stroke="var(--sl-accent)" />
    </Svg>
  );
}

/** A verifiable receipt (sky). */
export function ReceiptGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path
        d="M14 6h20v34l-4-3-3 3-3-3-3 3-3-3-4 3V6Z"
        stroke="var(--sl-settle)"
        fill="var(--sl-settle-soft)"
      />
      <path d="M19 15h10m-10 6h10m-10 6h6" stroke="var(--sl-settle)" />
      <circle cx="24" cy="6" r="0" />
    </Svg>
  );
}

/** An on-chain settlement block (sky). */
export function SettlementBlockGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M24 7 39 15v18L24 41 9 33V15L24 7Z" stroke="var(--sl-settle)" />
      <path d="M24 7v34M9 15l15 8 15-8" stroke="var(--sl-settle)" opacity=".6" />
      <path d="M24 23 39 15M24 23 9 15" stroke="var(--sl-settle)" opacity=".6" />
      <circle cx="24" cy="24" r="3" fill="var(--sl-accent-soft)" stroke="var(--sl-accent)" />
    </Svg>
  );
}

/** A market candle motif — derived trading data (amber). */
export function MarketCandleGlyph(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M6 40h36" stroke="var(--sl-border-strong)" />
      <path d="M14 10v26m0-20h0" stroke="var(--sl-market)" />
      <rect x="10.5" y="16" width="7" height="12" rx="1.5" fill="var(--sl-market-soft)" stroke="var(--sl-market)" />
      <path d="M26 6v30" stroke="var(--sl-accent)" />
      <rect x="22.5" y="12" width="7" height="14" rx="1.5" fill="var(--sl-accent-soft)" stroke="var(--sl-accent)" />
      <path d="M38 14v22" stroke="var(--sl-market)" />
      <rect x="34.5" y="22" width="7" height="9" rx="1.5" fill="var(--sl-market-soft)" stroke="var(--sl-market)" />
    </Svg>
  );
}

export const GLYPHS = {
  "machine-node": MachineNodeGlyph,
  agent: AgentGlyph,
  "price-tag-402": PriceTag402Glyph,
  "credit-coin": CreditCoinGlyph,
  receipt: ReceiptGlyph,
  "settlement-block": SettlementBlockGlyph,
  "market-candle": MarketCandleGlyph,
} as const;

export type GlyphName = keyof typeof GLYPHS;
