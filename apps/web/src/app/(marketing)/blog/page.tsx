// /blog — category tabs + latest posts. Seeded only with real, shipped posts
// (lib/resources.ts); empty categories simply don't appear.
import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@satelink/seo";
import { postsBySection, blogCategories } from "@/lib/resources";
import { PostList, ResourceHeader } from "@/components/ResourceViews";

export const metadata: Metadata = buildMetadata({
  title: "Blog",
  description: "Engineering notes and announcements from Satelink — machine commerce, x402, and the platform. Only real, shipped updates.",
  path: "/blog",
});

export default function BlogIndex() {
  const posts = postsBySection("blog");
  const categories = blogCategories();
  return (
    <>
      <ResourceHeader eyebrow="Blog" title="Notes from building the machine economy" />
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        {categories.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <span className="rounded-[var(--sl-radius-pill)] border border-sl-accent bg-sl-accent px-3 py-1 text-sm font-medium text-sl-accent-ink">All</span>
            {categories.map((c) => (
              <Link key={c} href={`/blog/category/${c}`} className="rounded-[var(--sl-radius-pill)] border border-sl-border px-3 py-1 text-sm text-sl-text-muted hover:border-sl-accent hover:text-sl-text">{c}</Link>
            ))}
          </div>
        )}
        <PostList posts={posts} basePath="/blog" />
      </section>
    </>
  );
}
