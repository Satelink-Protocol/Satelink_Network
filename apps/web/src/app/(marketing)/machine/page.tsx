// /machine — the public "For Agents" page. Server-rendered (fixes the old
// empty client-only shell): explains the HTTP 402 flow with an inline SVG
// sequence diagram, shows the discovery JSON and an x402-kit code sample, and
// states clearly that this rail is crypto-native and separate from Dodo (§6).
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Disclosure } from "@/components/ui/Disclosure";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "For Agents — x402 machine payments",
  description:
    "The machine rail: agents discover Satelink's JSON catalog, pay per call with x402 (USDC on Base) over HTTP 402, and get data back — no human checkout. Crypto-native, separate from Dodo.",
  alternates: { canonical: "https://satelink.network/machine" },
};

const DISCOVERY = `GET https://rpc.satelink.network/.well-known/satelink.json

{
  "x402": {
    "network": "eip155:8453",
    "asset": "USDC",
    "endpoint": "https://rpc.satelink.network/rpc/polygon",
    "price_per_call_usd": 0.01
  },
  "resources": [
    "https://rpc.satelink.network/v1/intelligence/*"
  ]
}`;

const X402_SAMPLE = `import { wrapFetchWithPayment } from "@x402/fetch";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";

// A funded wallet on Base (USDC). The client answers HTTP 402
// challenges automatically and retries the request paid.
const wallet = createWalletClient({ chain: base, transport: http() });
const fetchWithPay = wrapFetchWithPayment(fetch, wallet);

const res = await fetchWithPay(
  "https://rpc.satelink.network/v1/intelligence/funding-rate-heatmap"
);
const data = await res.json(); // paid, settled on-chain`;

function SequenceDiagram() {
  // Inline SVG, theme-aware via --sl-* tokens. Three lanes: Agent, Gateway,
  // Chain. Labelled arrows walk the 402 handshake top to bottom.
  const lanes = [
    { x: 90, label: "Agent" },
    { x: 300, label: "Gateway" },
    { x: 510, label: "Base (USDC)" },
  ];
  const steps: { from: number; to: number; y: number; label: string; back?: boolean }[] = [
    { from: 0, to: 1, y: 90, label: "GET /v1/intelligence/…" },
    { from: 1, to: 0, y: 130, label: "402 Payment Required", back: true },
    { from: 0, to: 2, y: 170, label: "pay $0.01 USDC (x402)" },
    { from: 0, to: 1, y: 210, label: "retry with payment proof" },
    { from: 1, to: 0, y: 250, label: "200 OK + data", back: true },
  ];
  return (
    <svg viewBox="0 0 600 300" className="w-full" role="img" aria-label="HTTP 402 payment sequence: Agent requests a resource, the Gateway returns 402, the Agent pays on Base with x402, retries, and receives 200 with data.">
      {lanes.map((l) => (
        <g key={l.label}>
          <text x={l.x} y={26} textAnchor="middle" fill="var(--sl-text)" fontSize="14" fontWeight="600" fontFamily="var(--sl-font-sans)">
            {l.label}
          </text>
          <line x1={l.x} y1={38} x2={l.x} y2={280} stroke="var(--sl-border)" strokeWidth="1.5" />
        </g>
      ))}
      {steps.map((s, i) => {
        const x1 = lanes[s.from].x;
        const x2 = lanes[s.to].x;
        return (
          <g key={i}>
            <line x1={x1} y1={s.y} x2={x2} y2={s.y} stroke="var(--sl-accent)" strokeWidth="2" markerEnd="url(#arrow)" strokeDasharray={s.back ? "6 4" : undefined} />
            <text x={(x1 + x2) / 2} y={s.y - 8} textAnchor="middle" fill="var(--sl-text-muted)" fontSize="12" fontFamily="var(--sl-font-mono)">
              {s.label}
            </text>
          </g>
        );
      })}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--sl-accent)" />
        </marker>
      </defs>
    </svg>
  );
}

export default function MachinePage() {
  return (
    <>
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <Badge variant="neutral" className="mb-4">Crypto-native rail — not processed by Dodo</Badge>
          <SectionHeader
            eyebrow="For Agents"
            title="Machines pay per call over HTTP 402"
            lede="No account, no human checkout. Agents discover the catalog, answer a 402 challenge with x402 (USDC on Base), and get data back — settled on-chain."
            align="left"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><a href="https://docs.satelink.network">Read the docs <ArrowRight className="size-4" /></a></Button>
            <Button asChild variant="secondary" size="lg"><a href="https://github.com/Satelink-Protocol/x402-kit">x402-kit on GitHub</a></Button>
          </div>
        </div>
      </section>

      {/* 402 flow */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="The flow" title="The 402 handshake" align="left" />
        <div className="mt-8 rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-6 sm:p-8">
          <SequenceDiagram />
        </div>
      </section>

      {/* Discovery */}
      <section className="border-y border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <SectionHeader eyebrow="Discovery" title="Advertised as public JSON" align="left" />
              <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
                Agents read the discovery document to learn the network, asset, price, and which
                resources are payable — then pay against them directly. No signup step.
              </p>
            </div>
            <CodeBlock code={DISCOVERY} ariaLabel="Discovery JSON" />
          </div>
        </div>
      </section>

      {/* Code */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Code" title="Pay a call with x402-kit" align="left" lede="The client answers the 402 challenge and retries the request paid — a few lines." />
        <div className="mt-8 max-w-3xl">
          <CodeBlock tabs={[{ label: "TypeScript", code: X402_SAMPLE }]} />
        </div>
        <div className="mt-6 max-w-3xl">
          <Disclosure title="Separate from the Dodo rail">
            x402 (USDC on Base) and on-chain USDT deposits are a crypto-native, machine-to-machine rail.
            Dodo Payments never processes them — Dodo only processes the card/UPI Starter Pack for
            humans. Both rails ultimately fund the same per-call API balance (see{" "}
            <Link href="/pricing">pricing</Link>).
          </Disclosure>
        </div>
      </section>

      {/* Pricing + CTA */}
      <section className="border-t border-sl-border bg-sl-bg-raised">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="font-sl-mono text-2xl font-bold text-sl-text">$0.01<span className="text-base font-medium text-sl-text-muted"> / intelligence call</span></p>
              <p className="mt-1 font-sl-mono text-sm text-sl-text-muted">$0.00003 / RPC call · pay per call, no commitment</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild><Link href="/pricing">See pricing</Link></Button>
              <Button asChild variant="secondary"><Link href="/intelligence">Browse the catalog</Link></Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
