// /customer-stories — intentionally empty until a real, permissioned story
// exists (§7). Hidden from nav/footer via the emptyCollections rule; the page
// itself renders an honest empty state rather than fabricated logos or quotes.
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { CUSTOMER_STORIES } from "@/lib/resources";
import { PostList, ResourceHeader } from "@/components/ResourceViews";

export const metadata: Metadata = buildMetadata({
  title: "Customer stories",
  description: "Customer stories from Satelink. We publish a story only with the customer's permission — no invented logos or quotes.",
  path: "/customer-stories",
  noindex: true,
});

export default function CustomerStories() {
  return (
    <>
      <ResourceHeader eyebrow="Customer stories" title="Real stories, with permission" />
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        <PostList posts={CUSTOMER_STORIES} basePath="/customer-stories" />
      </section>
    </>
  );
}
