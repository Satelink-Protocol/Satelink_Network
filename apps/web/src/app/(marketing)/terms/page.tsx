// apps/web/src/app/terms/page.tsx
//
// Real /terms route, migrated forward from the static public/terms.html
// (last updated May 19, 2026) with the legal-entity/jurisdiction details
// (Section 11) founder-provided 2026-09-18, the free-tier figure corrected
// to match production (500/day, not the stale 200/day), and the
// intelligence product + one-time credit-pack payment method added.
// public/terms.html itself is removed; /terms.html redirects here
// (next.config.ts) so the old URL still resolves.
import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
  description: "Satelink Network terms of service.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: May 19, 2026</p>

      <div className="mt-8 space-y-6 text-base text-muted-foreground">
        <p>
          Welcome to Satelink Network. By accessing or using our services, you
          agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;).
          Please read them carefully.
        </p>

        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Acceptance of Terms</h2>
          <p className="mt-2">
            By using Satelink Network — including the RPC gateway, the
            derived trading-intelligence product, the node operator program,
            or any other service we offer — you agree to these Terms. If you
            do not agree, do not use our services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. Service Description</h2>
          <p className="mt-2">Satelink Network provides:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong className="text-foreground">Decentralized RPC Infrastructure:</strong> multi-chain JSON-RPC access to blockchain networks, metered per call.</li>
            <li><strong className="text-foreground">Trading Intelligence:</strong> derived analytics (funding rates, open interest, liquidation clusters, market microstructure) computed from public market data — never raw exchange feed redistribution — metered per call.</li>
            <li><strong className="text-foreground">Node Operator Network:</strong> distributed infrastructure powered by community operators.</li>
            <li><strong className="text-foreground">On-Chain Settlement:</strong> USDT payments on Polygon for services rendered.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. User Obligations</h2>
          <h3 className="mt-4 text-base font-medium text-foreground">For Developers and Customers</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Use the API responsibly and within rate limits.</li>
            <li>Do not attempt to circumvent metering or billing.</li>
            <li>Do not use the services for illegal activities.</li>
            <li>Do not launch denial-of-service attacks.</li>
            <li>Keep your API keys secure and confidential.</li>
          </ul>
          <h3 className="mt-4 text-base font-medium text-foreground">For Node Operators</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Provide reliable, consistent service.</li>
            <li>Maintain advertised uptime and performance.</li>
            <li>Do not manipulate metrics or engage in fraudulent activity.</li>
            <li>Keep node software updated.</li>
            <li>Comply with applicable laws in your jurisdiction.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Pricing and Payments</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong className="text-foreground">RPC:</strong> $0.00003 per call, pay-as-you-go.</li>
            <li><strong className="text-foreground">Trading intelligence:</strong> $0.01 per call, pay-as-you-go.</li>
            <li><strong className="text-foreground">Free tier:</strong> 500 RPC requests per day per IP, no payment required; a free discovery tier for intelligence (catalog and prices only, no cost).</li>
            <li><strong className="text-foreground">Credit packs:</strong> one-time USD payment (card/UPI via Dodo Payments, or USDT deposit on Polygon), credited 1:1, never expiring, not a subscription. See <Link href="/pricing" className="underline">Pricing</Link>.</li>
            <li><strong className="text-foreground">Node operators:</strong> 50% revenue share of handled requests.</li>
            <li><strong className="text-foreground">Platform fee:</strong> 30% of total revenue.</li>
            <li><strong className="text-foreground">Distribution pool:</strong> 20% allocated for network growth.</li>
            <li><strong className="text-foreground">Settlement token:</strong> USDT on Polygon (Chain ID 137).</li>
          </ul>
          <p className="mt-2">
            Node-operator payments are processed automatically through our
            settlement contract; operators can claim earned USDT at any time.
            For what happens to your balance on a refund or a payment
            dispute, see the{" "}
            <Link href="/refund" className="underline">Refund &amp; Cancellation Policy</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. Service Availability</h2>
          <p className="mt-2">
            We strive for high availability but cannot guarantee
            uninterrupted service. Target uptime is best-effort, not a
            guaranteed SLA. Emergency maintenance may occur without notice
            for security issues. Check{" "}
            <a href="https://status.satelink.network" className="underline">status.satelink.network</a>{" "}
            for real-time service status.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">6. Intellectual Property</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong className="text-foreground">Open source:</strong> our core protocol code is open source under the MIT License.</li>
            <li><strong className="text-foreground">Trademarks:</strong> &ldquo;Satelink&rdquo; and the Satelink logo are trademarks of the operator.</li>
            <li><strong className="text-foreground">User data:</strong> you retain ownership of your data and content.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">7. Limitation of Liability</h2>
          <p className="mt-2 rounded-md border-l-2 border-foreground/40 bg-muted/30 px-4 py-3">
            Satelink Network is provided &ldquo;AS IS&rdquo; without warranty
            of any kind, express or implied.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>We are not liable for any indirect, incidental, or consequential damages.</li>
            <li>We are not liable for lost profits, data loss, or business interruption.</li>
            <li>Our maximum liability is limited to the amount you paid in the preceding 30 days.</li>
            <li>This limitation applies to the fullest extent permitted by law.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">8. Indemnification</h2>
          <p className="mt-2">
            You agree to indemnify and hold harmless Satelink Network, its
            operators, and affiliates from any claims, damages, or expenses
            arising from your use of the services, your violation of these
            Terms, or your violation of any third-party rights.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">9. Termination</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Either party may terminate at any time.</li>
            <li>Outstanding USDT settlements will be paid within 30 days.</li>
            <li>API keys will be revoked upon termination.</li>
            <li>Node operators must complete pending settlements before leaving the network.</li>
          </ul>
          <p className="mt-2">
            We reserve the right to suspend or terminate accounts that
            violate these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">10. Modifications</h2>
          <p className="mt-2">
            We may modify these Terms at any time. Changes are effective
            immediately upon posting. Continued use of the services
            constitutes acceptance of the modified Terms. For material
            changes we will provide 30 days&rsquo; notice via email (if
            provided) or on-site notification.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">11. Governing Law &amp; Dispute Resolution</h2>
          <p className="mt-2">
            Satelink Network is operated by Jakuraa Commercial Pvt Ltd, 38, 39
            Malaviya Street, Ram Nagar, Coimbatore &ndash; 641009, Tamil Nadu,
            India. These Terms are governed by the laws of Tamil Nadu, India.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">12. Severability</h2>
          <p className="mt-2">
            If any provision of these Terms is found unenforceable, the
            remaining provisions continue in full force and effect.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">13. Entire Agreement</h2>
          <p className="mt-2">
            These Terms, together with our{" "}
            <Link href="/privacy" className="underline">Privacy Policy</Link>{" "}
            and{" "}
            <Link href="/refund" className="underline">Refund &amp; Cancellation Policy</Link>,
            constitute the entire agreement between you and Satelink Network
            regarding use of our services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">14. Contact</h2>
          <p className="mt-2">
            For questions about these Terms, see{" "}
            <Link href="/contact" className="underline">Contact</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
