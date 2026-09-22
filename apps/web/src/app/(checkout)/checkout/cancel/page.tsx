// /checkout/cancel — abandoned/cancelled payment. Reassures the buyer they
// weren't charged and offers a retry.
import type { Metadata } from "next";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Payment not completed",
  robots: { index: false, follow: false },
};

export default function CheckoutCancelPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-sl-surface text-sl-text-subtle">
        <XCircle className="size-5" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-sl-text">Payment not completed</h1>
      <p className="mt-3 text-sm leading-relaxed text-sl-text-muted">
        You haven't been charged. You can pick up where you left off, or explore the free discovery tier
        first — no signup required.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="primary">
          <Link href="/checkout?plan=starter">Try again</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/pricing">Back to pricing</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/contact">Contact support</Link>
        </Button>
      </div>
    </div>
  );
}
