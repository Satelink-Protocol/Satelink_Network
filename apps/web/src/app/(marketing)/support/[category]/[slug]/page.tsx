// /support/[category]/[slug] — SupportArticleTemplate (body + "was this
// helpful?"). Params over the seeded, real articles only.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@satelink/seo";
import { SupportArticleTemplate, type Block } from "@satelink/web-ui";
import { ARTICLES, getArticle } from "@/lib/support";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ category: a.collection, slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string; slug: string }> }): Promise<Metadata> {
  const { category, slug } = await params;
  const a = getArticle(category, slug);
  if (!a) return { title: "Support article" };
  return buildMetadata({ title: `${a.title} — Support`, description: a.body[0] ?? a.title, path: `/support/${category}/${slug}`, type: "article" });
}

export default async function SupportArticlePage({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const a = getArticle(category, slug);
  if (!a) notFound();

  const blocks: Block[] = [{ blockType: "richText", html: a.body.map((p) => `<p>${p}</p>`).join("") }];
  if (a.related?.length) blocks.push({ blockType: "relatedContent", heading: "Related", items: a.related });

  return (
    <SupportArticleTemplate
      breadcrumbs={[
        { name: "Support", href: "/support" },
        { name: category, href: `/support/${category}` },
        { name: a.title, href: `/support/${category}/${a.slug}` },
      ]}
      title={a.title}
      blocks={blocks}
      articleId={`${category}/${slug}`}
    />
  );
}
