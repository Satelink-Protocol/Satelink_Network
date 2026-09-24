// System + non-content collections (§13): Users (RBAC + 2FA), Media, AuditLog,
// Enquiries, PricingDisplay, Redirects.
import type { CollectionConfig } from "payload";
import { ROLES, isSuperAdmin, hasRole, authenticated } from "../access/roles";

export const Users: CollectionConfig = {
  slug: "users",
  auth: {
    // Mandatory TOTP 2FA + short session + login rate limit (§13). The Payload
    // 2FA plugin/verify flow is enabled at config level; these bound the session.
    tokenExpiration: 60 * 60 * 12, // 12h
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
  },
  admin: { group: "Admin", useAsTitle: "email", defaultColumns: ["email", "role", "name"] },
  access: {
    read: authenticated,
    create: isSuperAdmin,
    update: ({ req }) => (req.user as { role?: string })?.role === "super-admin",
    delete: isSuperAdmin,
  },
  fields: [
    { name: "name", type: "text" },
    {
      name: "role",
      type: "select",
      required: true,
      defaultValue: "author",
      options: ROLES as unknown as string[],
      access: { update: ({ req }) => (req.user as { role?: string })?.role === "super-admin" },
    },
    { name: "totpEnabled", type: "checkbox", defaultValue: true, admin: { description: "TOTP 2FA is required for admin access." } },
  ],
};

export const Media: CollectionConfig = {
  slug: "media",
  admin: { group: "Content" },
  access: { read: () => true, create: authenticated, update: authenticated, delete: hasRole("content-admin") },
  upload: {
    // Vercel Blob adapter is attached in payload.config; local disk in dev.
    imageSizes: [
      { name: "thumbnail", width: 400 },
      { name: "og", width: 1200, height: 630 },
    ],
    mimeTypes: ["image/*", "video/*", "application/pdf"],
  },
  fields: [{ name: "alt", type: "text", required: true }],
};

export const AuditLog: CollectionConfig = {
  slug: "audit-log",
  admin: { group: "Admin", useAsTitle: "action", defaultColumns: ["action", "collectionSlug", "docId", "user", "ts"] },
  access: {
    read: hasRole("content-admin", "technical-admin"),
    create: () => true, // written by hooks with overrideAccess
    update: () => false,
    delete: () => false, // append-only
  },
  fields: [
    { name: "user", type: "relationship", relationTo: "users" },
    { name: "action", type: "text" },
    { name: "collectionSlug", type: "text" },
    { name: "docId", type: "text" },
    { name: "diff", type: "json" },
    { name: "ip", type: "text" },
    { name: "ts", type: "text" },
  ],
};

export const Enquiries: CollectionConfig = {
  slug: "enquiries",
  labels: { singular: "Enquiry", plural: "Enquiries" },
  admin: { group: "Admin", useAsTitle: "email", defaultColumns: ["kind", "email", "company", "ts"] },
  access: {
    // Written by the public form handlers (overrideAccess); readable by admins.
    read: hasRole("content-admin", "support-admin"),
    create: () => true,
    update: hasRole("support-admin"),
    delete: isSuperAdmin,
  },
  fields: [
    { name: "kind", type: "select", options: ["contact-sales", "corporate", "support-feedback"], required: true },
    { name: "name", type: "text" },
    { name: "email", type: "email", required: true },
    { name: "company", type: "text" },
    { name: "useCase", type: "text" },
    { name: "volume", type: "text" },
    { name: "message", type: "textarea" },
    { name: "ip", type: "text" },
    { name: "ts", type: "text" },
    { name: "emailConsent", type: "checkbox", defaultValue: false },
  ],
};

export const PricingDisplay: CollectionConfig = {
  slug: "pricing-display",
  labels: { singular: "Pricing display", plural: "Pricing display" },
  admin: { group: "Content", useAsTitle: "metric", defaultColumns: ["productSlug", "metric", "price", "currency"] },
  access: { read: () => true, create: hasRole("product-admin"), update: hasRole("product-admin"), delete: hasRole("product-admin") },
  fields: [
    { name: "productSlug", type: "text", required: true },
    { name: "metric", type: "text", required: true },
    { name: "unit", type: "text", defaultValue: "call" },
    { name: "price", type: "number", required: true },
    { name: "currency", type: "text", defaultValue: "USD" },
    { name: "note", type: "text", admin: { description: "Display-only. Parity-checked against the live catalog in CI." } },
  ],
};

export const Redirects: CollectionConfig = {
  slug: "redirects",
  admin: { group: "Admin", useAsTitle: "from", defaultColumns: ["from", "to", "permanent"] },
  access: { read: () => true, create: hasRole("technical-admin"), update: hasRole("technical-admin"), delete: hasRole("technical-admin") },
  fields: [
    { name: "from", type: "text", required: true, index: true },
    { name: "to", type: "text", required: true },
    { name: "permanent", type: "checkbox", defaultValue: true },
  ],
};
