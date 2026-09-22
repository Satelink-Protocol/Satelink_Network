// /academy/tutorials/[slug] — TutorialTemplate; steps become richText + code
// blocks. Illustrative badge on any step not run against a live endpoint.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMetadata } from "@satelink/seo";
import { TutorialTemplate, type Block } from "@satelink/web-ui";
import { TUTORIALS, getTutorial } from "@/lib/academy";

export function generateStaticParams() {
  return TUTORIALS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = getTutorial(slug);
  if (!t) return { title: "Tutorial" };
  return buildMetadata({ title: `${t.title} — Academy`, description: t.summary, path: `/academy/tutorials/${slug}`, type: "article" });
}

export default async function TutorialPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = getTutorial(slug);
  if (!t) notFound();

  const blocks: Block[] = [];
  for (const [i, step] of t.steps.entries()) {
    blocks.push({ blockType: "richText", html: `<h3>${i + 1}. ${step.heading}</h3><p>${step.body}</p>` });
    if (step.code) blocks.push({ blockType: "code", illustrative: step.illustrative, tabs: [{ language: "shell", code: step.code }] });
  }
  blocks.push({ blockType: "callout", tone: "success", body: `What you built: ${t.built}` });

  return (
    <TutorialTemplate
      breadcrumbs={[
        { name: "Academy", href: "/academy" },
        { name: "Tutorials", href: "/academy/tutorials" },
        { name: t.title, href: `/academy/tutorials/${t.slug}` },
      ]}
      title={t.title}
      product={t.product}
      prereqs={t.prereqs}
      blocks={blocks}
      illustrativeOnly={!t.live}
      nextHref={t.next ? `/academy/tutorials/${t.next.slug}` : undefined}
      nextLabel={t.next?.label}
    />
  );
}
