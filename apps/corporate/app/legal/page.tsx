import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal",
  description: "Terms of use and privacy information for the Jakuraa corporate website.",
};

const UPDATED = "September 24, 2026";

export default function Legal() {
  return (
    <section className="py-16 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Legal</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">Last updated: {UPDATED}</p>

      <div className="mt-10 max-w-2xl space-y-10">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Terms of use</h2>
          <div className="mt-3 space-y-3 text-[var(--muted)]">
            <p>
              This website (jakuraa.com) is provided for informational purposes
              about Jakuraa and its products. Content may change without notice
              and is provided &quot;as is&quot; without warranties of any kind.
            </p>
            <p>
              Use of the Satelink product is governed by the terms published at{" "}
              <a
                href="https://satelink.network"
                className="text-[var(--fg)] underline decoration-[var(--accent)] underline-offset-4"
              >
                satelink.network
              </a>
              , not by this page.
            </p>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold tracking-tight">Privacy</h2>
          <div className="mt-3 space-y-3 text-[var(--muted)]">
            <p>
              This marketing site does not require an account and does not collect
              personal information beyond what your browser sends with any request.
              If you email us, we use your message only to reply.
            </p>
            <p>
              Product data handling for Satelink is described in the Satelink
              privacy documentation.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
