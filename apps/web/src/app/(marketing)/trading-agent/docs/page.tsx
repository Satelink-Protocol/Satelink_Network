import type { Metadata } from "next";
import Link from "next/link";
import { requireSiteTradingAgent } from "@/lib/trading-agent/flag";
import { DOCS } from "@/lib/trading-agent/copy";
import { TaHeader } from "@/components/trading-agent/Parts";

export const metadata: Metadata = { title: "Documentation — Trading Agent", robots: { index: false, follow: false } };

export default function Page() {
  requireSiteTradingAgent();
  return (
    <>
      <TaHeader title={DOCS.title} lede={DOCS.body} />
      <ul className="grid list-disc gap-1 pl-5">
        <li><Link className="text-sl-accent underline" href="/trading-agent/how-it-works">How an order moves</Link></li>
        <li><Link className="text-sl-accent underline" href="/trading-agent/security">Security</Link></li>
        <li><Link className="text-sl-accent underline" href="/trading-agent/ai">How AI is used</Link></li>
      </ul>
    </>
  );
}
