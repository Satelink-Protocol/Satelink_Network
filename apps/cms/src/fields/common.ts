// Shared field sets for content collections (§16). Kept DRY so every content
// type carries the same SEO/GEO/status/relationship envelope.
import type { Field } from "payload";

export const SITES = ["satelink", "jakuraa"] as const;

export const statusField: Field = {
  name: "status",
  type: "select",
  defaultValue: "draft",
  options: ["draft", "review", "scheduled", "published", "archived"],
  admin: { position: "sidebar" },
  index: true,
};

export const siteField: Field = {
  name: "site",
  type: "select",
  defaultValue: "satelink",
  options: SITES as unknown as string[],
  admin: { position: "sidebar" },
  index: true,
};

export const slugField: Field = {
  name: "slug",
  type: "text",
  required: true,
  index: true,
  admin: { position: "sidebar" },
};

export const seoGroup: Field = {
  name: "seo",
  type: "group",
  fields: [
    { name: "title", type: "text" },
    { name: "description", type: "textarea" },
    { name: "ogTitle", type: "text" },
    { name: "ogDescription", type: "textarea" },
    { name: "ogImage", type: "upload", relationTo: "media" },
    { name: "canonical", type: "text" },
    { name: "schemaType", type: "text" },
    { name: "noindex", type: "checkbox" },
  ],
};

export const geoGroup: Field = {
  name: "geo",
  type: "group",
  admin: { description: "Answer-engine layer: a ≤50-word entity definition + key facts." },
  fields: [
    { name: "entityDefinition", type: "textarea", maxLength: 400 },
    { name: "keyFacts", type: "array", fields: [{ name: "fact", type: "text" }] },
    { name: "sources", type: "array", fields: [{ name: "url", type: "text" }] },
  ],
};

export const relationshipsFields: Field[] = [
  { name: "relatedProducts", type: "relationship", relationTo: "products", hasMany: true },
  { name: "relatedSolutions", type: "relationship", relationTo: "solutions", hasMany: true },
];

// Common envelope every content collection spreads in.
export function commonContentFields(opts?: { withRelationships?: boolean }): Field[] {
  return [
    slugField,
    siteField,
    statusField,
    { name: "description", type: "textarea" },
    seoGroup,
    geoGroup,
    ...(opts?.withRelationships ? relationshipsFields : []),
    { name: "publishedAt", type: "date", admin: { position: "sidebar" } },
    { name: "createdBy", type: "relationship", relationTo: "users", admin: { hidden: true } },
  ];
}
