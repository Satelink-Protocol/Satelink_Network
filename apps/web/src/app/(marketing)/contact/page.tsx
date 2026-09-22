// apps/web/src/app/contact/page.tsx
//
// New route — no dedicated contact page existed (only a footer mailto:).
// Support email, registered address, and response-time commitment are
// founder-provided facts (2026-09-18).

export const metadata = {
  title: "Contact",
  description: "How to reach Satelink Network for support, billing, privacy, or legal inquiries.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
      <p className="mt-4 text-base text-muted-foreground">
        For support, billing, refund requests, privacy inquiries, or anything
        else — reach us at the address below.
      </p>

      <div className="mt-8 rounded-lg border border-border p-6 text-base">
        <dl className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Support email</dt>
            <dd className="mt-1 text-sm text-foreground">
              <a href="mailto:support@satelink.network" className="underline">
                support@satelink.network
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Registered business address</dt>
            <dd className="mt-1 text-sm text-foreground">
              38, 39 Malaviya Street, Ram Nagar, Coimbatore &ndash; 641009, Tamil Nadu, India
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Response time</dt>
            <dd className="mt-1 text-sm text-foreground">
              We respond within 24 hours.
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        For real-time service status, see{" "}
        <a href="https://status.satelink.network" className="underline">
          status.satelink.network
        </a>
        . For technical documentation, see{" "}
        <a href="https://docs.satelink.network" className="underline">
          docs.satelink.network
        </a>
        .
      </p>
    </div>
  );
}
