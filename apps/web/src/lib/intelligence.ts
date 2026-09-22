// Typed, server-side catalog + status access for the Trading Intelligence
// product. Fetches the live discovery route with a 4s timeout and ISR
// revalidate (§8); on any failure falls back to the documented static
// constant in data/catalog.fallback.json (truth rule §2.1: never a fake
// number, a documented fallback is allowed). Everything is zod-validated.
import { z } from "zod";
import fallback from "../../data/catalog.fallback.json";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "https://rpc.satelink.network";

const MetricSchema = z.object({
  slug: z.string(),
  name: z.string(),
  kind: z.string(),
  isModel: z.boolean(),
  priceUsd: z.number(),
  measures: z.string(),
  description: z.string(),
});
export type Metric = z.infer<typeof MetricSchema>;

const CatalogSchema = z.object({
  updatedAt: z.string(),
  priceModel: z.object({ unit: z.string(), currency: z.string(), amount: z.number() }),
  rails: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      network: z.string(),
      asset: z.string(),
      endpoint: z.string(),
      discovery: z.string().optional(),
      processedByDodo: z.boolean(),
    })
  ),
  metrics: z.array(MetricSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;

/** The documented static fallback — always valid, always available. */
export function getFallbackCatalog(): Catalog {
  return CatalogSchema.parse(fallback);
}

/**
 * Normalize the live GET /v1/intelligence response into our Catalog shape.
 * The live route returns its own field names; we map defensively and fill any
 * gaps from the fallback so a partial/renamed live response never blanks the
 * page. Returns null if the live payload can't be mapped to >=1 metric.
 */
function mapLive(raw: unknown): Catalog | null {
  const fb = getFallbackCatalog();
  const obj = raw as Record<string, unknown>;
  const rawMetrics =
    (Array.isArray(obj?.metrics) && obj.metrics) ||
    (Array.isArray(obj?.endpoints) && obj.endpoints) ||
    (Array.isArray(obj?.data) && obj.data) ||
    null;
  if (!rawMetrics) return null;

  const metrics: Metric[] = [];
  for (const m of rawMetrics as Record<string, unknown>[]) {
    const slug = String(m.slug ?? m.metric ?? m.id ?? m.name ?? "").trim();
    if (!slug) continue;
    const seed = fb.metrics.find((x) => x.slug === slug);
    const kind = String(m.kind ?? seed?.kind ?? "derived");
    metrics.push({
      slug,
      name: String(m.name ?? seed?.name ?? slug),
      kind,
      isModel: Boolean(m.isModel ?? seed?.isModel ?? /model|proxy/i.test(kind)),
      priceUsd: Number(m.priceUsd ?? m.price ?? seed?.priceUsd ?? fb.priceModel.amount),
      measures: String(m.measures ?? seed?.measures ?? ""),
      description: String(m.description ?? seed?.description ?? ""),
    });
  }
  if (!metrics.length) return null;
  return { ...fb, metrics };
}

/** Live catalog with ISR + 4s timeout; falls back to the static constant. */
export async function getCatalog(): Promise<{ catalog: Catalog; live: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/v1/intelligence`, {
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 300 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const mapped = mapLive(await res.json());
    if (mapped) return { catalog: mapped, live: true };
    throw new Error("unmappable live payload");
  } catch {
    return { catalog: getFallbackCatalog(), live: false };
  }
}

export function getMetric(catalog: Catalog, slug: string): Metric | undefined {
  return catalog.metrics.find((m) => m.slug === slug);
}
