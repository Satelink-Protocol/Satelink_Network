// Idempotent seed (§18). Upserts by (site, type, slug); re-running updates,
// never duplicates. Run against the preview DB: `npm run seed`.
// Truth policy: seed ONLY real, true content. No invented customers/testimonials/
// people beyond the founder/metrics.
import { getPayload } from "payload";
import config from "../src/payload.config";

async function upsert(payload: Awaited<ReturnType<typeof getPayload>>, collection: string, where: Record<string, unknown>, data: Record<string, unknown>) {
  const existing = await payload.find({ collection: collection as never, where: where as never, limit: 1 });
  if (existing.docs[0]) {
    await payload.update({ collection: collection as never, id: existing.docs[0].id, data: data as never });
  } else {
    await payload.create({ collection: collection as never, data: data as never });
  }
}

async function main() {
  const payload = await getPayload({ config });

  // --- Founder (only verified person) ---
  await upsert(payload, "people", { slug: { equals: "founder" } }, {
    name: "Jakuraa", role: "Founder", group: "Founder", slug: "founder", status: "draft",
    // verifiedBy/verifiedAt set by a Super Admin in the admin UI before publish.
  });

  // --- Products (5) — original definitions, published ---
  const products = [
    { slug: "machine-commerce", title: "Machine Commerce", canonicalConcept: "machineCommerce" },
    { slug: "trading-intelligence", title: "Trading Intelligence", canonicalConcept: "tradingIntelligence", isDodoSurface: true, tags: ["trading-intelligence"] },
    { slug: "rpc", title: "RPC Infrastructure", canonicalConcept: "rpc" },
    { slug: "x402", title: "x402 Machine Payments", canonicalConcept: "x402" },
    { slug: "metering", title: "API Metering", canonicalConcept: "metering" },
  ];
  for (const p of products) {
    await upsert(payload, "products", { slug: { equals: p.slug } }, { site: "satelink", status: "draft", ...p });
  }

  // Navigation / Footer globals, support seed, academy tutorials (endpoint-gated),
  // and changelog import are added here as the corresponding content lands
  // (Phases 6–9). Kept minimal + true for now.

  // eslint-disable-next-line no-console
  console.log("Seed complete (idempotent).");
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
