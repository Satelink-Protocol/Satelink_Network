// Infographics band: payment rails, usage metering, settlement. Captions say
// plainly which parts are illustrative and which parts are not live yet.
import { MeteringWaterfall, SettlementFlow, TwoRailsDiagram } from "@satelink/web-ui";
import { SectionHeader } from "@/components/ui/SectionHeader";

const VAULT_URL = "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF";

export function UnderTheHood() {
  return (
    <section aria-labelledby="under-the-hood" className="border-b border-sl-border bg-sl-bg-raised">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-24">
        <SectionHeader eyebrow="Under the hood" title="Two rails, one meter, on-chain settlement" />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <figure className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5 lg:col-span-2">
            <TwoRailsDiagram className="mx-auto w-full" />
            <figcaption className="mt-3 text-sm text-sl-text-muted">
              Card and UPI payments buy Trading Intelligence credits; crypto (x402 or USDT) funds RPC and machine
              endpoints. The two balances never mix.
            </figcaption>
          </figure>
          <figure className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
            <MeteringWaterfall className="mx-auto w-full" />
            <figcaption className="mt-3 text-sm text-sl-text-muted">
              How a prepaid balance meters down per call. Figures are an illustrative example, not account data.
            </figcaption>
          </figure>
          <figure className="rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface p-5">
            <SettlementFlow className="mx-auto w-full" />
            <figcaption className="mt-3 text-sm text-sl-text-muted">
              The designed settlement path. Deposits to{" "}
              <a href={VAULT_URL} className="font-semibold text-sl-settle hover:underline">RevenueVault V2</a> are live;
              epoch settlement and the 50/30/20 split currently run in dry-run.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
