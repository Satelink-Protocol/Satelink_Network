import type { Metadata } from "next";
import { Illustration } from "@/components/Illustration";
import { ArrowLink, Container, PageHero, SectionHeading } from "@/components/Page";

export const metadata: Metadata = {
  title: "Technology",
  description: "Satelink, Jakuraa's technology business: machine-commerce infrastructure where agents pay per call and settle on-chain.",
};

const steps: [string, string][] = [
  ["Request", "An agent or machine calls a Satelink endpoint, for example a blockchain RPC method."],
  ["Price", "If the call is not yet paid for, Satelink answers with HTTP 402 and machine-readable payment terms."],
  ["Pay", "The caller pays for that request — USDC on Base via x402, or from prepaid USDT credits on Polygon."],
  ["Receive", "The request is served and metered. The payment and the usage record reconcile on-chain."],
];

const rails: [string, string, string][] = [
  ["x402", "USDC on Base", "Payment travels inside the HTTP request. No account and no API key: the wallet is the identity."],
  ["Prepaid credits", "USDT on Polygon", "Deposit once to the vault contract, then draw down per call with an API key."],
];

export default function TechnologyPage() {
  return (
    <>
      <PageHero
        eyebrow="Technology"
        title="Satelink: infrastructure for commerce between machines."
        lede={<p>Software agents increasingly act on their own. Satelink lets them buy what they need — one request at a time — without a sales contract, a monthly plan or a human in the loop.</p>}
      />
      <Container>
        <Illustration kind="network" className="mx-auto w-full max-w-lg text-green" />
      </Container>

      <section aria-labelledby="how" className="mt-20 border-t border-stone-1 py-20">
        <Container>
          <SectionHeading id="how" title="How a machine pays" />
          <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([t, b], i) => (
              <li key={t} className="border-t-2 border-green pt-5">
                <p className="text-sm text-amber-ink">Step {i + 1}</p>
                <h3 className="mt-1 font-serif text-2xl">{t}</h3>
                <p className="mt-3 leading-relaxed text-stone-4">{b}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="rails" className="bg-ivory-2 py-20">
        <Container>
          <SectionHeading id="rails" title="Two payment rails" />
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {rails.map(([name, asset, body]) => (
              <div key={name} className="rounded-2xl border border-stone-1 bg-ivory p-8">
                <p className="text-sm text-green">{asset}</p>
                <h3 className="mt-2 font-serif text-3xl">{name}</h3>
                <p className="mt-4 leading-relaxed text-stone-4">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl font-serif text-3xl leading-tight">Documentation, pricing and the developer console live on satelink.network.</p>
          <ArrowLink href="https://satelink.network">Go to satelink.network</ArrowLink>
        </Container>
      </section>
    </>
  );
}
