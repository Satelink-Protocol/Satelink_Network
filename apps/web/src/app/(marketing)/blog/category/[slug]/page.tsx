import type { Metadata } from "next";
import { buildMetadata } from "@satelink/seo";
import { postsBySection, blogCategories } from "@/lib/resources";
import { PostList, ResourceHeader } from "@/components/ResourceViews";

export function generateStaticParams() {
  return blogCategories().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return buildMetadata({ title: `${slug} — Blog`, description: `Satelink blog posts in ${slug}.`, path: `/blog/category/${slug}` });
}

export default async function BlogCategory({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const posts = postsBySection("blog").filter((p) => p.category === slug);
  return (
    <>
      <ResourceHeader eyebrow="Blog category" title={slug} />
      <section className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        <PostList posts={posts} basePath="/blog" />
      </section>
    </>
  );
}
