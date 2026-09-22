// /styleguide — renders every Satelink Signal component in both themes.
// noindex (§5.5). Each theme panel is a wrapper carrying data-theme, which
// re-scopes the --sl-* tokens locally (see tokens.css), so dark and light
// render side by side on one page regardless of the global theme.
import type { Metadata } from "next";
import type { ComponentType } from "react";
import { Activity, Cpu, Zap } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  CodeBlock,
  ComparisonTable,
  Disclosure,
  Field,
  Input,
  Textarea,
  Select,
  Checkbox,
  Icon,
  MetricCard,
  PriceCard,
  SectionHeader,
  StatTile,
  Stepper,
  TerminalWindow,
  ThemeToggle,
} from "@/components/ui";
import {
  BlockRenderer,
  type Block,
  // Signal 2.0 illustration kit
  MachineNodeGlyph,
  AgentGlyph,
  PriceTag402Glyph,
  CreditCoinGlyph,
  ReceiptGlyph,
  SettlementBlockGlyph,
  MarketCandleGlyph,
  // Infographics + hero demo
  LifecycleRing,
  PaymentSequence402,
  TwoRailsDiagram,
  MeteringWaterfall,
  SettlementFlow,
  MachinePaysDemo,
  // Motion primitives
  ScrollReveal,
  Stagger,
  StaggerItem,
  CountUp,
  HoverLift,
} from "@satelink/web-ui";

export const metadata: Metadata = {
  title: "Style guide",
  robots: { index: false, follow: false },
};

function Gallery() {
  return (
    <div className="space-y-10">
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Buttons</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <ThemeToggle />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Badges</h3>
        <div className="flex flex-wrap gap-2">
          <Badge variant="live" dot>Live</Badge>
          <Badge variant="planned">Planned — not yet available</Badge>
          <Badge variant="model">model / proxy</Badge>
          <Badge variant="neutral">derived</Badge>
          <Badge variant="up">+2.4%</Badge>
          <Badge variant="down">-1.1%</Badge>
        </div>
      </div>

      <SectionHeader
        eyebrow="Section header"
        title="Data is the hero"
        lede="Dense but calm. One accent. Monospace only for numbers and code."
        align="left"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Calls today" value="496,273" />
        <StatTile label="p50 latency" value="46" unit="ms" />
        <StatTile label="Uptime" loading />
        <StatTile label="Failed fetch" error />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card interactive>
          <CardTitle>Card</CardTitle>
          <CardDescription>An elevated surface with an optional hover state.</CardDescription>
        </Card>
        <MetricCard
          name="Funding-rate heatmap"
          slug="funding-rate-heatmap"
          kind="derived"
          price="$0.01/call"
          description="Cross-venue funding-rate divergence, computed from public market data."
        />
        <MetricCard
          name="Liquidation clusters"
          slug="liquidation-clusters"
          kind="derived-model"
          price="$0.01/call"
          isModel
          description="A modelled proxy for liquidation density — not measured orders."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <PriceCard tier="Free" price="$0" period="discovery" features={["Daily cap", "No card"]} cta={{ label: "No signup", disabled: true }} />
        <PriceCard tier="Starter Pack" price="$9.99" period="one-time" featured features={["1:1 USD credit", "No expiry"]} cta={{ label: "Get started", href: "#" }} note="Processed by Dodo (card / UPI)" />
        <PriceCard tier="Pay-per-call" price="$0.01" period="/call" features={["x402 / USDT", "No account"]} cta={{ label: "For agents", href: "#" }} note="Crypto rail — not processed by Dodo" />
      </div>

      <Disclosure title="Compliance">
        SaaS analytics — derived statistics from public market data. Not investment advice. Satelink never
        takes custody of funds. See <a href="/terms">Terms</a>.
      </Disclosure>

      <Stepper steps={["Account", "Review", "Pay"]} current={2} />

      <TerminalWindow title="rpc.satelink.network">
        <span className="text-sl-text-muted">$ </span>curl https://rpc.satelink.network/v1/intelligence
      </TerminalWindow>

      <CodeBlock
        tabs={[
          { label: "curl", code: 'curl https://rpc.satelink.network/v1/intelligence' },
          { label: "TS", code: 'const r = await fetch("https://rpc.satelink.network/v1/intelligence");' },
          { label: "Python", code: 'import requests\nrequests.get("https://rpc.satelink.network/v1/intelligence")' },
        ]}
      />

      <ComparisonTable
        columns={["Feature", "Satelink", "Generic"]}
        highlightColumn={1}
        rows={[
          { label: "Pay per call", cells: [true, false] },
          { label: "Price / call", cells: ["$0.01", "$0.05"] },
          { label: "No subscription", cells: [true, false] },
        ]}
      />

      <form className="grid gap-4 sm:max-w-md">
        <Field label="Work email" htmlFor="sg-email" required>
          <Input id="sg-email" type="email" placeholder="you@company.com" />
        </Field>
        <Field label="Use case" htmlFor="sg-use">
          <Select id="sg-use" defaultValue="">
            <option value="" disabled>Select…</option>
            <option>Research desk</option>
            <option>Agent framework</option>
          </Select>
        </Field>
        <Field label="Message" htmlFor="sg-msg" error="This field is required">
          <Textarea id="sg-msg" aria-invalid />
        </Field>
        <Checkbox id="sg-consent" label="I agree to the Terms and Refund Policy" />
      </form>

      <div className="flex gap-4">
        <Icon as={Activity} className="size-6 text-sl-accent" />
        <Icon as={Cpu} className="size-6 text-sl-info" />
        <Icon as={Zap} className="size-6 text-sl-warn" />
      </div>

      {/* ── Signal 2.0 (P1) ──────────────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Colour tokens</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Swatch name="accent" varName="--sl-accent" role="platform" />
          <Swatch name="machine" varName="--sl-machine" role="agents / x402" />
          <Swatch name="market" varName="--sl-market" role="market data" />
          <Swatch name="settle" varName="--sl-settle" role="settlement" />
          <Swatch name="up" varName="--sl-up" role="delta +" />
          <Swatch name="down" varName="--sl-down" role="delta −" />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Gradients</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sl-grad-hero flex h-24 items-end rounded-[var(--sl-radius)] border border-sl-border p-3">
            <span className="font-sl-mono text-xs text-sl-text-muted">--sl-grad-hero</span>
          </div>
          <div className="sl-grad-brand flex h-24 items-end rounded-[var(--sl-radius)] p-3">
            <span className="font-sl-mono text-xs text-sl-accent-ink">--sl-grad-brand</span>
          </div>
          <div className="flex h-24 items-center justify-center rounded-[var(--sl-radius)] border border-sl-border">
            <span className="sl-text-grad font-sl-display text-2xl font-extrabold">Signal 2.0</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Display type (Manrope)</h3>
        <p className="font-sl-display font-extrabold tracking-tight text-sl-text" style={{ fontSize: "var(--sl-display-2)" }}>
          Commerce for software that pays software.
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Illustration kit</h3>
        <div className="grid grid-cols-4 gap-4 sm:grid-cols-7" data-illustrations>
          {[
            [MachineNodeGlyph, "machine-node"],
            [AgentGlyph, "agent"],
            [PriceTag402Glyph, "price-tag-402"],
            [CreditCoinGlyph, "credit-coin"],
            [ReceiptGlyph, "receipt"],
            [SettlementBlockGlyph, "settlement-block"],
            [MarketCandleGlyph, "market-candle"],
          ].map(([G, label]) => {
            const Glyph = G as ComponentType<{ title?: string; size?: number }>;
            return (
              <figure key={label as string} className="flex flex-col items-center gap-2 rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-3">
                <Glyph title={label as string} size={40} />
                <figcaption className="text-center font-sl-mono text-[10px] text-sl-text-subtle">{label as string}</figcaption>
              </figure>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Infographics</h3>
        <div className="grid gap-6" data-infographics>
          <div className="flex justify-center rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4"><LifecycleRing size={340} /></div>
          <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4"><PaymentSequence402 /></div>
          <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4"><TwoRailsDiagram /></div>
          <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4"><MeteringWaterfall /></div>
          <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-4"><SettlementFlow /></div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Hero demo — MachinePaysDemo</h3>
        <div className="max-w-lg"><MachinePaysDemo /></div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sl-text-subtle">Motion primitives</h3>
        <div className="space-y-4" data-motion>
          <ScrollReveal>
            <Card><CardTitle>ScrollReveal</CardTitle><CardDescription>Fades + lifts into view once.</CardDescription></Card>
          </ScrollReveal>
          <Stagger className="grid gap-3 sm:grid-cols-3">
            {["One", "Two", "Three"].map((t) => (
              <StaggerItem key={t}><Card><CardTitle>{t}</CardTitle></Card></StaggerItem>
            ))}
          </Stagger>
          <div className="flex items-baseline gap-2">
            <CountUp value={496273} className="font-sl-mono text-2xl font-bold text-sl-accent" />
            <span className="text-sm text-sl-text-muted">calls (count-up, live values only)</span>
          </div>
          <HoverLift className="max-w-xs">
            <Card interactive><CardTitle>HoverLift</CardTitle><CardDescription>Lifts on hover.</CardDescription></Card>
          </HoverLift>
        </div>
      </div>
    </div>
  );
}

function Swatch({ name, varName, role }: { name: string; varName: string; role: string }) {
  return (
    <div className="rounded-[var(--sl-radius)] border border-sl-border bg-sl-surface p-2">
      <div className="h-10 w-full rounded-[var(--sl-radius-sm)]" style={{ background: `var(${varName})` }} />
      <p className="mt-1.5 font-sl-mono text-[11px] font-semibold text-sl-text">{name}</p>
      <p className="font-sl-mono text-[10px] text-sl-text-subtle">{role}</p>
    </div>
  );
}

function ThemePanel({ theme }: { theme: "dark" | "light" }) {
  return (
    <section data-theme={theme} className="rounded-[var(--sl-radius-lg)] bg-sl-bg p-6 text-sl-text sm:p-10">
      <p className="mb-6 font-sl-mono text-xs uppercase tracking-widest text-sl-text-subtle">
        {theme} theme
      </p>
      <Gallery />
    </section>
  );
}

// One instance of every CMS block (§8/§16) — the Phase 6 gate renders them all.
const SAMPLE_BLOCKS: Block[] = [
  { blockType: "hero", eyebrow: "Product", heading: "Machine Commerce Infrastructure", definition: "Infrastructure for software to discover, pay for, and settle machine-native services.", ctas: [{ label: "Start building", href: "/developers/quickstart" }, { label: "Explore", href: "/products/machine-commerce" }] },
  { blockType: "richText", text: "Plain-English body copy renders here as prose." },
  { blockType: "valueCards", cards: [{ title: "Discover services", body: "Machines find services via discovery + catalog." }, { title: "Pay per use", body: "Per-call pricing, no commitment." }, { title: "Settle transparently", body: "On-chain settlement per epoch." }] },
  { blockType: "code", illustrative: true, tabs: [{ language: "curl", code: "curl https://rpc.satelink.network/v1/intelligence" }, { language: "typescript", code: "const r = await fetch(url)" }] },
  { blockType: "apiExample", endpoint: "GET /v1/intelligence", request: "curl …", response: '{ "ok": true }' },
  { blockType: "faq", group: "About the offering", items: [{ question: "What stops an agent from paying a price that isn't real?", answer: "Prices come from signed HTTP 402 requirements, with per-key limits and receipts." }] },
  { blockType: "cta", heading: "Build for the machine economy.", label: "Start building", href: "/developers/quickstart" },
  { blockType: "callout", tone: "info", body: "The crypto rail (x402/USDT) is separate — not billed through Dodo." },
  { blockType: "pricingLive", productSlug: "trading-intelligence", prices: [{ metric: "funding-rate-heatmap", price: 0.01, unit: "call" }] },
  { blockType: "lifecycleStepper" },
  { blockType: "machineReadablePanel", productSlug: "trading-intelligence" },
  { blockType: "comparisonTable", columns: ["Free", "Pay-per-call"], rows: [{ label: "Per-call price", values: ["$0", "$0.00003"] }, { label: "Commitment", values: [true, false] }] },
  { blockType: "relatedContent", heading: "Related", items: [{ label: "x402", href: "/products/x402" }, { label: "API", href: "/platform/api" }] },
];

function BlocksGallery() {
  return (
    <div className="space-y-2">
      {SAMPLE_BLOCKS.map((b) => (
        <div key={b.blockType} data-block={b.blockType} className="rounded-[var(--sl-radius)] border border-dashed border-sl-border">
          <p className="px-4 pt-3 font-sl-mono text-[10px] uppercase tracking-widest text-sl-text-subtle">{b.blockType}</p>
          <BlockRenderer blocks={[b]} />
        </div>
      ))}
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <div className="min-h-screen bg-sl-bg p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <h1 className="text-2xl font-bold tracking-tight text-sl-text">Satelink Signal — style guide</h1>
        <div className="grid gap-8 lg:grid-cols-2">
          <ThemePanel theme="dark" />
          <ThemePanel theme="light" />
        </div>
        <section>
          <h2 className="mb-4 text-lg font-semibold text-sl-text">CMS blocks (§8)</h2>
          <BlocksGallery />
        </section>
      </div>
    </div>
  );
}
