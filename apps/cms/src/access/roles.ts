// RBAC (§13). Eight roles; access helpers used across collections.
import type { Access, FieldAccess } from "payload";

export const ROLES = [
  "super-admin",
  "content-admin",
  "seo-admin",
  "product-admin",
  "support-admin",
  "technical-admin",
  "editor",
  "author",
] as const;
export type Role = (typeof ROLES)[number];

type U = { role?: Role; id?: string | number } | undefined;
const roleOf = (user: U): Role | undefined => user?.role;

export const isSuperAdmin: Access = ({ req }) => roleOf(req.user as U) === "super-admin";

export const hasRole =
  (...roles: Role[]): Access =>
  ({ req }) => {
    const r = roleOf(req.user as U);
    return !!r && (r === "super-admin" || roles.includes(r));
  };

export const isAdminField =
  (...roles: Role[]): FieldAccess =>
  ({ req }) => {
    const r = roleOf(req.user as U);
    return !!r && (r === "super-admin" || roles.includes(r));
  };

// Authors edit only their own drafts; everyone above author can read all.
export const authorOwnOrAbove: Access = ({ req }) => {
  const u = req.user as U;
  const r = roleOf(u);
  if (!r) return false;
  if (r !== "author") return true;
  return { createdBy: { equals: u?.id } };
};

// Publish of Product/Pricing is barred for Editor/Author (enforced in hooks too).
export const canPublish = hasRole(
  "content-admin",
  "product-admin",
  "seo-admin",
  "support-admin",
  "technical-admin"
);

export const authenticated: Access = ({ req }) => Boolean(req.user);
