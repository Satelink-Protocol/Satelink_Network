import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Jakuraa about partnerships, press, or Satelink.",
};

export default function Contact() {
  return (
    <section className="py-16 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Contact</h1>
      <p className="mt-6 max-w-2xl text-lg text-[var(--muted)]">
        For partnerships, press, or anything about Jakuraa, email us.
      </p>

      <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] p-5">
          <h2 className="font-medium">General &amp; partnerships</h2>
          <a
            href="mailto:hello@jakuraa.com"
            className="mt-2 inline-block text-sm text-[var(--fg)] underline decoration-[var(--accent)] underline-offset-4"
          >
            hello@jakuraa.com
          </a>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-5">
          <h2 className="font-medium">Using the product</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Building on the network? Start at{" "}
            <a
              href="https://satelink.network"
              className="text-[var(--fg)] underline decoration-[var(--accent)] underline-offset-4"
            >
              satelink.network
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
