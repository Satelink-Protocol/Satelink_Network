// apps/web/src/components/legal-footer-links.tsx
//
// Minimal legal-links strip for standalone product/checkout-adjacent pages
// (/pricing, /intelligence, /tasks) that don't inherit the homepage's full
// nav/footer. Keeps Terms/Privacy/Refund/Contact one click away from any
// page a buyer or a payments reviewer might land on mid-checkout.
import Link from "next/link";

export function LegalFooterLinks() {
  return (
    <div className="mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-xs text-muted-foreground">
      <Link href="/pricing" className="hover:text-foreground">
        Pricing
      </Link>
      <Link href="/terms" className="hover:text-foreground">
        Terms of Service
      </Link>
      <Link href="/privacy" className="hover:text-foreground">
        Privacy Policy
      </Link>
      <Link href="/refund" className="hover:text-foreground">
        Refund &amp; Cancellation
      </Link>
      <Link href="/contact" className="hover:text-foreground">
        Contact
      </Link>
    </div>
  );
}
