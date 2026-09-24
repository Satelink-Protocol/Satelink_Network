// On publish/unpublish → notify the public sites to revalidateTag, and trigger
// sitemap/llms regeneration (§13). Fire-and-forget; never block the write.
import type { CollectionAfterChangeHook } from "payload";

const SECRET = process.env.CMS_REVALIDATE_SECRET ?? "";
const TARGETS = [process.env.SATELINK_WEB_URL, process.env.JAKURAA_WEB_URL].filter(Boolean) as string[];

export const revalidateOnPublish: CollectionAfterChangeHook = async ({ doc, previousDoc, collection }) => {
  const becamePublished = doc?.status === "published";
  const changedPublishState = doc?.status !== previousDoc?.status;
  if (!becamePublished && !changedPublishState) return doc;
  if (!SECRET || TARGETS.length === 0) return doc;

  const tag = `${collection.slug}:${doc?.slug ?? doc?.id}`;
  await Promise.allSettled(
    TARGETS.map((base) =>
      fetch(`${base}/api/revalidate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": SECRET },
        body: JSON.stringify({ tags: [tag, collection.slug], regenerate: ["sitemap", "llms"] }),
      })
    )
  );
  return doc;
};
