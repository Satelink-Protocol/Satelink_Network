import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@satelink/seo";
import { postsBySection, getPost } from "@/lib/resources";
import { ArticleView } from "@/components/ResourceViews";

export function generateStaticParams() {
  return postsBySection("news").map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost("news", slug);
  if (!post) return { title: "news" };
  return buildMetadata({ title: post.title, description: post.subtitle, path: `/news/${slug}`, type: "article" });
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost("news", slug);
  if (!post) notFound();
  return <ArticleView post={post} basePath="/news" />;
}
