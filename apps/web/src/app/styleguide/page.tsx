// /styleguide — renders every Satelink Signal component in both themes.
// noindex (§5.5). Each theme panel is a wrapper carrying data-theme, which
// re-scopes the --sl-* tokens locally (see tokens.css), so dark and light
// render side by side on one page regardless of the global theme.
import type { Metadata } from "next";
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

export default function StyleguidePage() {
  return (
    <div className="min-h-screen bg-sl-bg p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <h1 className="text-2xl font-bold tracking-tight text-sl-text">Satelink Signal — style guide</h1>
        <div className="grid gap-8 lg:grid-cols-2">
          <ThemePanel theme="dark" />
          <ThemePanel theme="light" />
        </div>
      </div>
    </div>
  );
}
