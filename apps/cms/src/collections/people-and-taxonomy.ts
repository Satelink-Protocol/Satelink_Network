// People (leadership, verified-to-publish), JobOpening, Author, Category, Tag.
import type { CollectionConfig } from "payload";
import { hasRole, authenticated, isAdminField } from "../access/roles";
import { requireVerifiedToPublish, stampPublishedAt } from "../hooks/truth";
import { auditAfterChange } from "../hooks/audit-log";
import { statusField, siteField } from "../fields/common";

export const People: CollectionConfig = {
  slug: "people",
  labels: { singular: "Person", plural: "People" },
  admin: { group: "Company", useAsTitle: "name", defaultColumns: ["name", "role", "group", "status"] },
  versions: { drafts: true },
  access: { read: () => true, create: authenticated, update: hasRole("content-admin"), delete: hasRole("content-admin") },
  hooks: { beforeChange: [requireVerifiedToPublish, stampPublishedAt], afterChange: [auditAfterChange] },
  fields: [
    { name: "name", type: "text", required: true },
    { name: "role", type: "text" },
    { name: "group", type: "select", options: ["Founder", "Leadership", "Advisor"], defaultValue: "Leadership" },
    { name: "photo", type: "upload", relationTo: "media" },
    { name: "bio", type: "textarea" },
    statusField,
    // Invented-data guard: verified by a Super Admin before publish.
    { name: "verifiedBy", type: "relationship", relationTo: "users", access: { update: isAdminField() } },
    { name: "verifiedAt", type: "date", access: { update: isAdminField() } },
    { name: "publishedAt", type: "date", admin: { position: "sidebar" } },
  ],
};

export const JobOpenings: CollectionConfig = {
  slug: "job-openings",
  labels: { singular: "Job opening", plural: "Job openings" },
  admin: { group: "Company", useAsTitle: "title", defaultColumns: ["title", "team", "location", "status"] },
  versions: { drafts: true },
  access: { read: () => true, create: authenticated, update: hasRole("content-admin"), delete: hasRole("content-admin") },
  hooks: { beforeChange: [stampPublishedAt], afterChange: [auditAfterChange] },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, index: true },
    { name: "team", type: "text" },
    { name: "location", type: "text" },
    { name: "type", type: "select", options: ["full-time", "part-time", "contract", "internship"] },
    { name: "body", type: "richText" },
    { name: "applyUrl", type: "text" },
    statusField,
    { name: "publishedAt", type: "date", admin: { position: "sidebar" } },
  ],
};

export const Authors: CollectionConfig = {
  slug: "authors",
  admin: { group: "Taxonomy", useAsTitle: "name" },
  access: { read: () => true, create: authenticated, update: authenticated, delete: hasRole("content-admin") },
  fields: [
    { name: "name", type: "text", required: true },
    { name: "title", type: "text" },
    { name: "avatar", type: "upload", relationTo: "media" },
    { name: "bio", type: "textarea" },
  ],
};

const taxonomy = (slug: string, singular: string, plural: string): CollectionConfig => ({
  slug,
  labels: { singular, plural },
  admin: { group: "Taxonomy", useAsTitle: "name" },
  access: { read: () => true, create: authenticated, update: authenticated, delete: hasRole("content-admin") },
  fields: [
    { name: "name", type: "text", required: true },
    { name: "slug", type: "text", required: true, index: true },
    { name: "description", type: "textarea" },
    siteField,
  ],
});

export const Categories = taxonomy("categories", "Category", "Categories");
export const Tags = taxonomy("tags", "Tag", "Tags");
