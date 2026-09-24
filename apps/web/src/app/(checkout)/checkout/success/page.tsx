// /checkout/success — styled pass-through. The canonical post-payment page is
// /intelligence/success (PR #398 claim-token flow). If a claim token is
// present we forward to it verbatim, preserving the token exactly and NOT
// weakening #398. With no claim we show a styled pending state (never grant or
// display credits here).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { Disclosure } from "@/components/ui/Disclosure";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Payment received",
  robots: { index: false, follow: false },
};

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const { claim } = await searchParams;
  if (claim) {
    // Preserve the one-time claim token exactly; the canonical page exchanges it.
    redirect(`/intelligence/success?claim=${encodeURIComponent(claim)}`);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-sl-accent-soft text-sl-accent">
        <Clock className="size-5" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-sl-text">Payment received</h1>
      <p className="mt-3 text-sm leading-relaxed text-sl-text-muted">
        Thanks — Dodo has your payment and we're confirming it. Card payments usually confirm in a few
        seconds; UPI can take up to ~48 hours. Your API key and credits appear only after the payment is
        confirmed. Check the receipt email Dodo sent you for your claim link.
      </p>

      <div className="mt-6">
        <Disclosure title="No credits are granted until confirmed">
          We never display or grant credits before the payment is confirmed by the backend. If your
          balance hasn't updated after confirmation,{" "}
          <Link href="/contact">contact us</Link> with your payment receipt.
        </Disclosure>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="secondary">
          <a href="https://docs.satelink.network">Read the docs</a>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/intelligence">Back to Intelligence</Link>
        </Button>
      </div>
    </div>
  );
}
