// /news — real announcements only (lib/resources.ts). Empty → EmptyState.
import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { postsBySection } from "@/lib/resources";
import { PostList, ResourceHeader } from "@/components/ResourceViews";

export const metadata: Metadata = buildMetadata({
  title: "News",
  description: "Announcements from Satelink — shipped milestones and platform news. Only real updates.",
  path: "/news",
});

export default function NewsIndex() {
  return (
    <>
      <ResourceHeader eyebrow="News" title="What we've shipped" />
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        <PostList posts={postsBySection("news")} basePath="/news" />
      </section>
    </>
  );
}
