// Content-collection factory (§13). Produces a CollectionConfig with the shared
// envelope, a composable blocks body, drafts/versions/scheduled publish, RBAC,
// audit + truth + revalidate hooks. Explicit collections (Users, Media, etc.)
// live in their own files.
import type { CollectionConfig, Field } from "payload";
import { commonContentFields } from "../fields/common";
import { layoutBlocks } from "../blocks";
import { authorOwnOrAbove, authenticated, hasRole } from "../access/roles";
import { auditAfterChange, auditAfterDelete } from "../hooks/audit-log";
import { bannedPhraseGuard, dodoScopeGuard, stampPublishedAt } from "../hooks/truth";
import { revalidateOnPublish } from "../hooks/revalidate";

export type ContentOpts = {
  slug: string;
  labelSingular: string;
  labelPlural: string;
  group: string;
  extraFields?: Field[];
  withRelationships?: boolean;
};

export function contentCollection(opts: ContentOpts): CollectionConfig {
  return {
    slug: opts.slug,
    labels: { singular: opts.labelSingular, plural: opts.labelPlural },
    admin: {
      group: opts.group,
      useAsTitle: "title",
      defaultColumns: ["title", "site", "status", "publishedAt"],
      preview: (doc) =>
        `${process.env.SATELINK_WEB_URL ?? "http://localhost:3000"}/api/preview?slug=${doc?.slug}&type=${opts.slug}`,
    },
    versions: { drafts: { autosave: true, schedulePublish: true }, maxPerDoc: 25 },
    access: {
      read: () => true, // public read (REST); drafts require auth via Payload draft access
      create: authenticated,
      update: authorOwnOrAbove,
      delete: hasRole("content-admin"),
    },
    hooks: {
      beforeChange: [bannedPhraseGuard, dodoScopeGuard, stampPublishedAt],
      afterChange: [auditAfterChange, revalidateOnPublish],
      afterDelete: [auditAfterDelete],
    },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "hero", type: "upload", relationTo: "media" },
      { name: "body", type: "blocks", blocks: layoutBlocks },
      ...commonContentFields({ withRelationships: opts.withRelationships }),
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "category", type: "relationship", relationTo: "categories" },
      { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
      ...(opts.extraFields ?? []),
    ],
  };
}
