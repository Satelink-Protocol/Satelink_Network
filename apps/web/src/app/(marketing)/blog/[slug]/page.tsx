import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@satelink/seo";
import { postsBySection, getPost } from "@/lib/resources";
import { ArticleView } from "@/components/ResourceViews";

export function generateStaticParams() {
  return postsBySection("blog").map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost("blog", slug);
  if (!post) return { title: "Post" };
  return buildMetadata({ title: post.title, description: post.subtitle, path: `/blog/${slug}`, type: "article" });
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost("blog", slug);
  if (!post) notFound();
  return <ArticleView post={post} basePath="/blog" />;
}
