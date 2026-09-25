// "The console" — real product imagery: screenshots captured from the running
// console (production build) against the local test harness. The data is TEST
// DATA and the caption says so; nothing here is a customer or a live metric.
import Image from "next/image";
import { SectionHeader } from "@/components/ui/SectionHeader";

const CONSOLE = "https://console.satelink.network";

export function ConsoleShowcase() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24" aria-labelledby="console-h">
      <SectionHeader eyebrow="The console" title="Simple for anyone. Powerful when you need it." lede="Start with four plain tasks — get market data, give your software access, add money, see what you've spent. Switch to Advanced for the full analytics view." />
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {[
          { src: "/product/console-home-simple-1440-light.jpg", alt: "Satelink console in Simple mode: four task cards and the plan allowance meters", cap: "Simple mode" },
          { src: "/product/console-home-advanced-1440-light.jpg", alt: "Satelink console in Advanced mode: balance, spend, plan usage and per-agent charts", cap: "Advanced mode" },
        ].map((f) => (
          <figure key={f.src} className="overflow-hidden rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface">
            <Image src={f.src} alt={f.alt} width={1440} height={900} sizes="(min-width: 1024px) 560px, 100vw" className="h-auto w-full" />
            <figcaption className="flex items-center justify-between border-t border-sl-border px-4 py-3 text-[13px]">
              <span className="text-sl-text">{f.cap}</span>
              <span className="text-sl-text-muted">Shown with test data</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-8 text-center"><a className="text-sl-text underline underline-offset-4" href={`${CONSOLE}/sign-in?mode=signup`}>Open the console</a></p>
    </section>
  );
}
