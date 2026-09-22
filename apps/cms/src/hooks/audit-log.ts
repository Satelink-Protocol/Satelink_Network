// Audit log (§13): every create/update/delete/publish writes an AuditLog row
// (user, action, collection, doc id, diff, timestamp, IP). Attached as an
// afterChange + afterDelete hook on audited collections.
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from "payload";

function shallowDiff(prev: unknown, next: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const a = (prev ?? {}) as Record<string, unknown>;
  const b = (next ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "updatedAt" || k === "createdAt") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = { from: a[k], to: b[k] };
  }
  return out;
}

export const auditAfterChange: CollectionAfterChangeHook = async ({
  req,
  operation,
  doc,
  previousDoc,
  collection,
}) => {
  try {
    const published = doc?.status === "published" && previousDoc?.status !== "published";
    await req.payload.create({
      collection: "audit-log",
      data: {
        user: (req.user as { id?: string | number })?.id ?? null,
        action: published ? "publish" : operation, // create | update | publish
        collectionSlug: collection.slug,
        docId: String(doc?.id ?? ""),
        diff: shallowDiff(previousDoc, doc),
        ip: req.headers?.get?.("x-forwarded-for") ?? "",
        ts: new Date().toISOString(),
      },
      // Avoid recursion / access checks for the audit write itself.
      overrideAccess: true,
    });
  } catch {
    /* never block the primary write on an audit failure */
  }
  return doc;
};

export const auditAfterDelete: CollectionAfterDeleteHook = async ({ req, id, collection }) => {
  try {
    await req.payload.create({
      collection: "audit-log",
      data: {
        user: (req.user as { id?: string | number })?.id ?? null,
        action: "delete",
        collectionSlug: collection.slug,
        docId: String(id),
        diff: {},
        ip: req.headers?.get?.("x-forwarded-for") ?? "",
        ts: new Date().toISOString(),
      },
      overrideAccess: true,
    });
  } catch {
    /* ignore */
  }
};
