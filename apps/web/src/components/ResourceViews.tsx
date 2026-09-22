// Shared renderers for the Resources section (§8): a post list, an article
// view (ArticleTemplate + a richText body block), and an empty state. No
// invented content — callers pass real, shipped posts from lib/resources.ts.
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ArticleTemplate, type Block } from "@satelink/web-ui";
import { articleLd, breadcrumbLd, jsonLdScript } from "@satelink/seo";
import { SITES } from "@satelink/content";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import type { ResourcePost, ResourceSection } from "@/lib/resources";

const SECTION_LABEL: Record<ResourceSection, string> = { blog: "Blog", news: "News", changelog: "Changelog" };

function fmt(date: string) {
  return new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PostList({ posts, basePath }: { posts: ResourcePost[]; basePath: string }) {
  if (posts.length === 0) return <EmptyResources />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => (
        <Card key={p.slug} interactive className="flex flex-col">
          <div className="flex items-center gap-2 text-xs text-sl-text-subtle">
            {p.category && <span className="font-sl-mono text-sl-accent">{p.category}</span>}
            <time dateTime={p.date}>{fmt(p.date)}</time>
          </div>
          <CardTitle className="mt-2 text-base">{p.title}</CardTitle>
          <p className="mt-2 flex-1 text-sm text-sl-text-muted">{p.subtitle}</p>
          <Link href={`${basePath}/${p.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sl-accent hover:text-sl-accent-strong">
            Read <ArrowRight className="size-3.5" />
          </Link>
        </Card>
      ))}
    </div>
  );
}

export function EmptyResources({ label = "Nothing here yet" }: { label?: string }) {
  return (
    <div className="rounded-[var(--sl-radius-lg)] border border-dashed border-sl-border bg-sl-surface p-10 text-center">
      <p className="text-sm text-sl-text-muted">{label}</p>
      <p className="mt-1 text-xs text-sl-text-subtle">We publish only real, shipped updates — check back soon.</p>
    </div>
  );
}

export function ArticleView({ post, basePath }: { post: ResourcePost; basePath: string }) {
  const html = post.body.map((para) => `<p>${para}</p>`).join("");
  const blocks: Block[] = [
    { blockType: "richText", html },
  ];
  if (post.links?.length) {
    blocks.push({ blockType: "relatedContent", heading: "Related", items: post.links.map((l) => ({ label: l.label, href: l.href })) });
  }
  const url = `${SITES.satelink.origin}${basePath}/${post.slug}`;
  const ldType = post.section === "news" ? "NewsArticle" : post.section === "changelog" ? "TechArticle" : "Article";
  const ld = [
    articleLd({ headline: post.title, url, datePublished: post.date, author: post.author, type: ldType }),
    breadcrumbLd([
      { name: SECTION_LABEL[post.section], url: `${SITES.satelink.origin}${basePath}` },
      { name: post.title, url },
    ]),
  ];
  return (
    <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />
    <ArticleTemplate
      breadcrumbs={[
        { name: SECTION_LABEL[post.section], href: basePath },
        { name: post.title, href: `${basePath}/${post.slug}` },
      ]}
      category={post.category ?? SECTION_LABEL[post.section]}
      title={post.title}
      subtitle={post.subtitle}
      author={post.author}
      publishedAt={post.date}
      blocks={blocks}
    />
    </>
  );
}

export function ResourceHeader({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <section className="mx-auto max-w-[1100px] px-4 pt-16 sm:px-6">
      <SectionHeader eyebrow={eyebrow} title={title} lede={lede} align="left" />
    </section>
  );
}
