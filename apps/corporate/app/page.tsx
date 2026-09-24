import Link from "next/link";
import { businesses } from "@/content/businesses";
import { principles } from "@/content/company";
import { sortedNews } from "@/content/people";
import { Illustration } from "@/components/Illustration";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLink, Container, SectionHeading, formatDate } from "@/components/Page";

export default function Home() {
  const latest = sortedNews().slice(0, 3);
  return (
    <>
      <Container className="grid items-center gap-10 pb-16 pt-16 sm:pt-28 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-sm font-medium text-green">Established 2019 · Coimbatore, India</p>
          <h1 className="mt-4 font-serif text-[2.75rem] leading-[1.05] tracking-tight sm:text-7xl">
            We build the infrastructure machines trade on.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-stone-4 sm:text-xl">
            Jakuraa is a technology and trading company. We operate Satelink, where software agents pay for what they use and
            settle on-chain, and we hold registrations to trade, import, export and manufacture.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/businesses" className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-ivory hover:bg-green">
              Our businesses
            </Link>
            <Link href="/company" className="rounded-full border border-stone-2 px-5 py-3 text-sm font-medium hover:border-ink">
              About the company
            </Link>
          </div>
        </div>
        <Illustration kind="mission" className="hidden w-full max-w-sm justify-self-end text-green lg:block" />
      </Container>

      <section aria-labelledby="businesses" className="border-t border-stone-1 py-20 sm:py-28">
        <Container>
          <SectionHeading
            id="businesses"
            title="Our businesses"
            lede="Each business is labelled for what it is today: operating, a registered capability, or planned."
          />
          <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-stone-1 bg-stone-1 sm:grid-cols-2 lg:grid-cols-3">
            {businesses.map((b) => (
              <li key={b.slug} className="bg-ivory">
                <Link href={`/businesses/${b.slug}`} className="group flex h-full flex-col p-7 hover:bg-ivory-2">
                  <Illustration kind={b.illustration} className="h-24 w-auto self-start text-stone-3 group-hover:text-green" />
                  <div className="mt-6"><StatusBadge status={b.status} /></div>
                  <h3 className="mt-3 font-serif text-2xl">{b.short}</h3>
                  <p className="mt-2 flex-1 text-stone-4">{b.summary}</p>
                  <span className="mt-6 text-sm font-medium text-green">Learn more →</span>
                </Link>
              </li>
            ))}
            <li className="bg-ivory-2">
              <Link href="/businesses" className="group flex h-full flex-col justify-end p-7 hover:bg-stone-1/60">
                <p className="font-serif text-2xl">One parent company.</p>
                <p className="mt-2 text-stone-4">How each business is based on our constitution or a government registration.</p>
                <span className="mt-6 text-sm font-medium text-green">All businesses →</span>
              </Link>
            </li>
          </ul>
        </Container>
      </section>

      <section aria-labelledby="satelink" className="bg-green py-20 text-ivory sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-medium text-[#c9d9cf]">Technology</p>
            <h2 id="satelink" className="mt-3 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
              Satelink: commerce between machines.
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#dfe8e2]">
              An autonomous agent asks for data, pays for exactly that request, and gets the answer — no contract, no monthly
              plan. Payment travels in the HTTP request over x402, or draws down prepaid credits settled on Polygon.
            </p>
            <div className="mt-8 flex flex-wrap gap-5 text-sm font-medium">
              <Link href="/technology" className="underline decoration-[#8fb09d] underline-offset-4 hover:decoration-ivory">
                How Satelink works
              </Link>
              <a href="https://satelink.network" className="underline decoration-[#8fb09d] underline-offset-4 hover:decoration-ivory">
                satelink.network ↗
              </a>
            </div>
          </div>
          <Illustration kind="network" className="w-full max-w-md justify-self-center text-[#b9cfc1]" />
        </Container>
      </section>

      <section aria-labelledby="principles" className="py-20 sm:py-28">
        <Container>
          <SectionHeading id="principles" title="How we work" />
          <div className="mt-12 grid gap-10 sm:grid-cols-2">
            {principles.map((p, i) => (
              <div key={p.title} className="border-t border-stone-2 pt-6">
                <p className="font-serif text-sm text-amber-ink">0{i + 1}</p>
                <h3 className="mt-2 font-serif text-2xl">{p.title}</h3>
                <p className="mt-3 max-w-md leading-relaxed text-stone-4">{p.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {latest.length > 0 && (
        <section aria-labelledby="news" className="border-t border-stone-1 py-20 sm:py-28">
          <Container>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHeading id="news" title="Latest news" />
              <ArrowLink href="/news">All news</ArrowLink>
            </div>
            <ul className="mt-10 divide-y divide-stone-1 border-y border-stone-1">
              {latest.map((n) => (
                <li key={n.slug}>
                  <Link href={`/news/${n.slug}`} className="group grid gap-2 py-6 sm:grid-cols-[180px_1fr]">
                    <time dateTime={n.date} className="text-sm text-stone-3">{formatDate(n.date)}</time>
                    <span>
                      <span className="font-serif text-xl group-hover:text-green">{n.title}</span>
                      <span className="mt-1 block text-stone-4">{n.summary}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </>
  );
}
