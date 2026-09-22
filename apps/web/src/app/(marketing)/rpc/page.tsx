// /rpc — the RPC gateway as a secondary product (§3/§4). Factual: flat
// $0.00003/call, 500-req/day free tier, multi-chain. No competitor comparison
// table (competitor cells can't be independently verified here — §3).
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Disclosure } from "@/components/ui/Disclosure";

export const metadata: Metadata = {
  title: "RPC Gateway",
  description:
    "Satelink's multi-chain JSON-RPC gateway: flat $0.00003 per call, a 500-requests/day free tier, metered on the same account balance. A machine-native rail — pay with x402 or USDT.",
  alternates: { canonical: "https://satelink.network/rpc" },
};

const RPC_SAMPLE = `curl -X POST https://rpc.satelink.network/rpc \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'`;

export default function RpcPage() {
  return (
    <>
      <section className="border-b border-sl-border">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
          <SectionHeader
            eyebrow="RPC Gateway"
            title="Multi-chain JSON-RPC, metered per call"
            lede="The infrastructure the intelligence product runs on, also sold directly: a flat $0.00003 per call with a 500-requests/day free tier, no account required to start."
            align="left"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><a href="https://docs.satelink.network">Read the docs <ArrowRight className="size-4" /></a></Button>
            <Button asChild variant="secondary" size="lg"><Link href="/pricing">See pricing</Link></Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <SectionHeader eyebrow="Try it" title="One request, no key" align="left" />
            <p className="mt-4 text-sm leading-relaxed text-sl-text-muted">
              The free tier serves 500 requests/day per IP with no account. Beyond that, calls are
              metered at $0.00003 and deducted from your credit balance.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-sl-text-muted">
              {["Polygon, Ethereum, Base, Arbitrum", "Flat $0.00003 / call", "500 req/day free tier", "Same balance as intelligence + x402"].map((f) => (
                <li key={f} className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-sl-accent" />{f}</li>
              ))}
            </ul>
          </div>
          <CodeBlock code={RPC_SAMPLE} ariaLabel="RPC request" />
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6">
        <Disclosure title="Crypto-native rail">
          RPC is billed on the same per-call balance as Trading Intelligence. You can fund it with a
          card/UPI credit pack (via Dodo) or pay machine-to-machine with x402 / on-chain USDT — the
          crypto rail Dodo never processes. See <Link href="/machine">For Agents</Link>.
        </Disclosure>
      </section>
    </>
  );
}
