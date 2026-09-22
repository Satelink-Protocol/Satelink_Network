// Truth hooks (§13) — beforeChange, BLOCK publish on violation. Mirrors the
// apps/web truth-lint so CMS content can never ship a banned claim, a mis-scoped
// Dodo mention, or an unverified testimonial/person.
import type { CollectionBeforeChangeHook } from "payload";
import { APIError } from "payload";

// Promissory investment-advice phrases (not the bare words) + hype absolutes.
const BANNED = [
  /\bguaranteed?\s+(returns?|profits?|gains?|yield)\b/i,
  /\brisk[-\s]?free\b/i,
  /\bassured?\s+returns?\b/i,
  /\bwe\s+guarantee\b/i,
  /\bfinancial\s+advice\b/i,
  /\binvestment\s+advice\b/i,
  /\bsignals?\s+to\s+(buy|sell|trade)\b/i,
];

function textOf(data: unknown): string {
  return JSON.stringify(data ?? "").toLowerCase();
}

export const bannedPhraseGuard: CollectionBeforeChangeHook = ({ data }) => {
  const body = textOf(data);
  for (const re of BANNED) {
    if (re.test(body)) {
      throw new APIError(`Blocked: banned phrase matches ${re}. See docs/web/ia-v2/19-validation-suite.md.`, 400);
    }
  }
  return data;
};

// Dodo may only be mentioned on documents tagged trading-intelligence.
export const dodoScopeGuard: CollectionBeforeChangeHook = ({ data }) => {
  const body = textOf(data);
  if (!body.includes("dodo")) return data;
  const tags: string[] = (data?.tags ?? []).map((t: unknown) => String(t).toLowerCase());
  const slug = String(data?.slug ?? "").toLowerCase();
  const ok = tags.includes("trading-intelligence") || slug.includes("trading-intelligence");
  if (!ok) {
    throw new APIError("Blocked: 'Dodo' may only appear on trading-intelligence documents (payments boundary).", 400);
  }
  return data;
};

// Testimonials / customer stories / people require verifiedBy + verifiedAt to
// reach Published — enforced here in addition to field-level access.
export const requireVerifiedToPublish: CollectionBeforeChangeHook = ({ data }) => {
  if (data?.status !== "published") return data;
  if (!data?.verifiedBy || !data?.verifiedAt) {
    throw new APIError("Blocked: publishing requires verifiedBy + verifiedAt (invented-data guard).", 400);
  }
  return data;
};

// Set publishedAt when transitioning to published.
export const stampPublishedAt: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (data?.status === "published" && originalDoc?.status !== "published" && !data?.publishedAt) {
    data.publishedAt = new Date().toISOString();
  }
  return data;
};
