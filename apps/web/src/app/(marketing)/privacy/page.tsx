// apps/web/src/app/privacy/page.tsx
//
// Real /privacy route, migrated forward from the static public/privacy.html
// (last updated May 19, 2026), with contact channels pointed at /contact
// instead of unverified @satelink.network addresses. public/privacy.html
// itself is removed; /privacy.html redirects here (next.config.ts).
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
  description: "Satelink Network privacy policy — what we collect, why, and your rights.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: May 19, 2026</p>

      <div className="mt-8 space-y-6 text-base text-muted-foreground">
        <p>
          At Satelink Network, we are committed to protecting your privacy.
          This Privacy Policy explains how we collect, use, disclose, and
          safeguard your information when you use our platform.
        </p>

        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Information We Collect</h2>
          <h3 className="mt-4 text-base font-medium text-foreground">API usage data</h3>
          <p className="mt-2">When you use the RPC gateway or intelligence API, we collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Request and response metadata (timestamps, endpoints, status codes)</li>
            <li>API key identifiers</li>
            <li>Request volume and patterns</li>
            <li>Error logs for debugging purposes</li>
          </ul>
          <h3 className="mt-4 text-base font-medium text-foreground">Node operator data</h3>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>IP addresses (for routing purposes)</li>
            <li>Hardware specifications submitted during registration</li>
            <li>Performance metrics (uptime, latency, success rates)</li>
            <li>Earnings and settlement history</li>
          </ul>
          <h3 className="mt-4 text-base font-medium text-foreground">Wallet addresses</h3>
          <p className="mt-2">Collected solely to process USDT settlements on Polygon, verify deposit transactions, and distribute node-operator earnings.</p>
          <h3 className="mt-4 text-base font-medium text-foreground">Payment data</h3>
          <p className="mt-2">
            Credit-pack purchases are processed by Dodo Payments; we receive
            payment confirmation and amount, not full card/UPI details, which
            Dodo handles directly.
          </p>
          <h3 className="mt-4 text-base font-medium text-foreground">Optional information</h3>
          <p className="mt-2">You may optionally provide an email address (for notifications, alerts, and order confirmations).</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. How We Use Information</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Operate and improve the platform</li>
            <li>Process payments, refunds, and settlements</li>
            <li>Monitor network health and security</li>
            <li>Provide customer support</li>
            <li>Generate aggregated, anonymized analytics</li>
            <li>Detect and prevent fraud or abuse</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. Data Sharing</h2>
          <p className="mt-2 font-medium text-foreground">We do NOT sell your data.</p>
          <p className="mt-2">We may share information with:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong className="text-foreground">Blockchain networks:</strong> settlement transactions are public on Polygon and viewable on Polygonscan.</li>
            <li><strong className="text-foreground">Payment processor:</strong> Dodo Payments, for credit-pack checkout and refunds.</li>
            <li><strong className="text-foreground">Infrastructure providers:</strong> Cloudflare (CDN/DDoS protection), Railway and Vercel (hosting).</li>
            <li><strong className="text-foreground">Legal requirements:</strong> when required by law or to protect our rights.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Data Retention</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><strong className="text-foreground">API logs:</strong> 90 days</li>
            <li><strong className="text-foreground">Settlement and payment records:</strong> permanent (settlements are recorded on-chain; payment records are kept for accounting and dispute resolution)</li>
            <li><strong className="text-foreground">Account data:</strong> until account deletion is requested</li>
            <li><strong className="text-foreground">Performance metrics:</strong> 1-year rolling window</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. Your Rights</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Access your data upon request</li>
            <li>Request deletion of your account</li>
            <li>Opt out of non-essential analytics</li>
            <li>Export your usage and earnings data</li>
            <li>Update or correct your information</li>
          </ul>
          <p className="mt-2">
            To exercise these rights, see{" "}
            <Link href="/contact" className="underline">Contact</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">6. Security</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>All connections encrypted with TLS</li>
            <li>No password storage for API access (wallet- or key-based authentication)</li>
            <li>API keys are hashed, not stored in plaintext</li>
            <li>Payment card/UPI details are never handled or stored by us — Dodo Payments processes them directly</li>
            <li>Infrastructure monitoring and intrusion detection</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">7. Cookies and Tracking</h2>
          <p className="mt-2">
            We use minimal cookies: essential cookies for session management
            and authentication, and a preference cookie for theme (dark/light
            mode). We do not use third-party tracking or advertising cookies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">8. International Data Transfers</h2>
          <p className="mt-2">
            Our infrastructure is distributed globally. By using Satelink,
            you consent to your data being processed in the jurisdictions
            where our nodes and hosting providers operate.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">9. Children&rsquo;s Privacy</h2>
          <p className="mt-2">
            Satelink is not intended for users under 18. We do not knowingly
            collect information from children.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">10. Changes to This Policy</h2>
          <p className="mt-2">
            We may update this Privacy Policy from time to time. Changes are
            posted on this page with an updated revision date. For material
            changes, we will notify users via email if provided.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">11. Data Controller</h2>
          <p className="mt-2">
            Jakuraa Commercial Pvt Ltd, 38, 39 Malaviya Street, Ram Nagar,
            Coimbatore &ndash; 641009, Tamil Nadu, India.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">12. Contact</h2>
          <p className="mt-2">
            For privacy-related inquiries, see{" "}
            <Link href="/contact" className="underline">Contact</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
