// CMS content client.
//
// Phase 2 state: the Payload CMS (apps/cms) is not yet running, so this client
// resolves reads from the bundled fallback fixtures. Phase 4 wires the CMS REST
// base (CMS_API_URL) with ISR + on-publish revalidateTag; the fallback path
// stays as the guaranteed-available last resort so a public build never fails
// when the CMS is down (§4).
import { z } from "zod";

export type FetchOptions = {
  /** ISR revalidation window in seconds (Next `next.revalidate`). */
  revalidate?: number;
  /** Cache tag for on-publish invalidation (Next `next.tags`). */
  tag?: string;
};

const CMS_BASE = process.env.CMS_API_URL || "";

/**
 * Fetch and validate a CMS document collection. Returns `fallback` on any
 * failure (network, non-2xx, schema mismatch) so callers always render.
 */
export async function getCollection<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  fallback: z.infer<T>,
  opts: FetchOptions = {}
): Promise<z.infer<T>> {
  if (!CMS_BASE) return fallback;
  try {
    const res = await fetch(`${CMS_BASE}${path}`, {
      // Next.js reads these; harmless elsewhere.
      next: { revalidate: opts.revalidate ?? 300, tags: opts.tag ? [opts.tag] : undefined },
    } as RequestInit);
    if (!res.ok) return fallback;
    const json = await res.json();
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function cmsConfigured(): boolean {
  return Boolean(CMS_BASE);
}
