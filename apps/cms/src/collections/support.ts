// Support, FAQ, Feedback, Announcement (§13).
import type { CollectionConfig } from "payload";
import { hasRole, authenticated } from "../access/roles";
import { auditAfterChange } from "../hooks/audit-log";
import { bannedPhraseGuard, stampPublishedAt } from "../hooks/truth";
import { revalidateOnPublish } from "../hooks/revalidate";
import { statusField, siteField } from "../fields/common";

export const SupportCategories: CollectionConfig = {
  slug: "support-categories",
  labels: { singular: "Support category", plural: "Support categories" },
  admin: { group: "Support", useAsTitle: "title", defaultColumns: ["title", "order"] },
  access: { read: () => true, create: authenticated, update: hasRole("support-admin"), delete: hasRole("support-admin") },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, index: true },
    { name: "parent", type: "relationship", relationTo: "support-categories" },
    { name: "order", type: "number", defaultValue: 0 },
    { name: "icon", type: "text" },
  ],
};

export const SupportArticles: CollectionConfig = {
  slug: "support-articles",
  labels: { singular: "Support article", plural: "Support articles" },
  admin: { group: "Support", useAsTitle: "title", defaultColumns: ["title", "category", "status"] },
  versions: { drafts: { autosave: true, schedulePublish: true } },
  access: { read: () => true, create: authenticated, update: hasRole("support-admin"), delete: hasRole("support-admin") },
  hooks: { beforeChange: [bannedPhraseGuard, stampPublishedAt], afterChange: [auditAfterChange, revalidateOnPublish] },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, index: true },
    { name: "category", type: "relationship", relationTo: "support-categories" },
    { name: "product", type: "relationship", relationTo: "products" },
    { name: "body", type: "richText" },
    { name: "helpfulVotes", type: "number", defaultValue: 0, admin: { readOnly: true } },
    statusField,
    { name: "publishedAt", type: "date", admin: { position: "sidebar" } },
  ],
};

export const FAQs: CollectionConfig = {
  slug: "faqs",
  labels: { singular: "FAQ", plural: "FAQs" },
  admin: { group: "Support", useAsTitle: "question" },
  access: { read: () => true, create: authenticated, update: hasRole("support-admin", "content-admin"), delete: hasRole("content-admin") },
  hooks: { beforeChange: [bannedPhraseGuard] },
  fields: [
    { name: "question", type: "text", required: true },
    { name: "answer", type: "textarea", required: true },
    { name: "group", type: "text" },
    siteField,
  ],
};

export const Feedback: CollectionConfig = {
  slug: "feedback",
  admin: { group: "Support", useAsTitle: "comment", defaultColumns: ["helpful", "article", "ts"] },
  access: { read: hasRole("support-admin"), create: () => true, update: () => false, delete: hasRole("support-admin") },
  fields: [
    { name: "article", type: "relationship", relationTo: "support-articles" },
    { name: "helpful", type: "checkbox" },
    { name: "comment", type: "textarea" },
    { name: "ts", type: "text" },
  ],
};

export const Announcements: CollectionConfig = {
  slug: "announcements",
  admin: { group: "Content", useAsTitle: "text" },
  access: { read: () => true, create: hasRole("content-admin"), update: hasRole("content-admin"), delete: hasRole("content-admin") },
  fields: [
    { name: "text", type: "text", required: true },
    { name: "href", type: "text" },
    { name: "startsAt", type: "date" },
    { name: "endsAt", type: "date" },
  ],
};
