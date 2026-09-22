// Page templates (§8). Templates are thin: they render the standard chrome
// (breadcrumb, meta, related, feedback) around a CMS `blocks` body. Product,
// Solution and Platform pages all use PageTemplate — they differ only in the
// blocks the CMS composes (07-templates-and-blocks.md).
import * as React from "react";
import Link from "next/link";
import { Breadcrumbs, type Crumb } from "../components/site/Breadcrumbs";
import { BlockRenderer, type Block } from "../blocks/BlockRenderer";
import { Button } from "../components/ui/Button";

export function PageTemplate({ breadcrumbs, blocks }: { breadcrumbs: Crumb[]; blocks: Block[] }) {
  return (
    <>
      <Breadcrumbs items={breadcrumbs} />
      <BlockRenderer blocks={blocks} />
    </>
  );
}

export function ArticleTemplate({
  breadcrumbs,
  category,
  title,
  subtitle,
  author,
  publishedAt,
  updatedAt,
  blocks,
}: {
  breadcrumbs: Crumb[];
  category?: string;
  title: string;
  subtitle?: string;
  author?: string;
  publishedAt?: string;
  updatedAt?: string;
  blocks: Block[];
}) {
  return (
    <article>
      <Breadcrumbs items={breadcrumbs} />
      <header className="mx-auto max-w-[720px] px-4 pt-6 sm:px-6">
        {category && <p className="font-sl-mono text-sm text-sl-accent">{category}</p>}
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-sl-text sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 text-lg text-sl-text-muted">{subtitle}</p>}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-sl-text-subtle">
          {author && <span>{author}</span>}
          {publishedAt && <time dateTime={publishedAt}>Published {new Date(publishedAt).toLocaleDateString()}</time>}
          {updatedAt && updatedAt !== publishedAt && <time dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleDateString()}</time>}
        </div>
      </header>
      <div className="mx-auto max-w-[720px]">
        <BlockRenderer blocks={blocks} />
      </div>
    </article>
  );
}

export function TutorialTemplate({
  breadcrumbs,
  title,
  product,
  prereqs = [],
  blocks,
  nextHref,
  nextLabel,
  illustrativeOnly,
}: {
  breadcrumbs: Crumb[];
  title: string;
  product?: string;
  prereqs?: string[];
  blocks: Block[];
  nextHref?: string;
  nextLabel?: string;
  /** True when no live endpoint backs this tutorial — shows the "Available soon" note. */
  illustrativeOnly?: boolean;
}) {
  return (
    <div>
      <Breadcrumbs items={breadcrumbs} />
      <header className="mx-auto max-w-[760px] px-4 pt-6 sm:px-6">
        {product && <p className="font-sl-mono text-sm text-sl-accent">{product}</p>}
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-sl-text">{title}</h1>
        {illustrativeOnly && (
          <p className="mt-4 rounded-[var(--sl-radius)] border border-sl-warn/40 bg-sl-warn/10 p-3 text-sm text-sl-text-muted">
            Available soon — this walkthrough is illustrative until the endpoint ships.
          </p>
        )}
        {prereqs.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sl-text-subtle">Prerequisites</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-sl-text-muted">{prereqs.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
      </header>
      <div className="mx-auto max-w-[760px]"><BlockRenderer blocks={blocks} /></div>
      {nextHref && (
        <div className="mx-auto max-w-[760px] px-4 pb-16 sm:px-6">
          <Button asChild variant="secondary"><Link href={nextHref}>Next: {nextLabel ?? "Continue"}</Link></Button>
        </div>
      )}
    </div>
  );
}

export function SupportArticleTemplate({
  breadcrumbs,
  title,
  blocks,
  articleId,
}: {
  breadcrumbs: Crumb[];
  title: string;
  blocks: Block[];
  articleId?: string;
}) {
  return (
    <div>
      <Breadcrumbs items={breadcrumbs} />
      <header className="mx-auto max-w-[720px] px-4 pt-6 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-sl-text">{title}</h1>
      </header>
      <div className="mx-auto max-w-[720px]"><BlockRenderer blocks={blocks} /></div>
      <div className="mx-auto max-w-[720px] px-4 pb-16 sm:px-6">
        <HelpfulVotes articleId={articleId} />
      </div>
    </div>
  );
}

export function HelpfulVotes({ articleId }: { articleId?: string }) {
  return (
    <form
      className="flex items-center gap-3 rounded-[var(--sl-radius)] border border-sl-border p-4"
      action="/api/support-feedback"
      method="post"
    >
      <input type="hidden" name="article" value={articleId ?? ""} />
      <span className="text-sm text-sl-text-muted">Was this helpful?</span>
      <button name="helpful" value="yes" className="rounded-[var(--sl-radius-sm)] border border-sl-border px-3 py-1 text-sm text-sl-text hover:border-sl-accent">Yes</button>
      <button name="helpful" value="no" className="rounded-[var(--sl-radius-sm)] border border-sl-border px-3 py-1 text-sm text-sl-text hover:border-sl-accent">No</button>
    </form>
  );
}
