// Better Auth session lookup. The session cookie is set on .satelink.network
// (crossSubDomainCookies), so sign-in on satelink.network carries across to
// console.satelink.network. We forward only the Better Auth cookies.
import { cookies } from "next/headers";
import { apiFetch } from "./api";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  twoFactorEnabled?: boolean;
  createdAt?: string;
};

export type Session = { user: SessionUser; session: { id: string; expiresAt: string } };

export const SESSION_COOKIE_NAMES = ["__Secure-satelink.session_token", "satelink.session_token"];

export async function authCookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((c) => c.name.includes("satelink.") && !c.name.startsWith("slc_"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function getSession(): Promise<Session | null> {
  const cookie = await authCookieHeader();
  if (!cookie) return null;
  const r = await apiFetch<Session | null>("/api/identity/get-session", { cookie });
  return r.ok && r.data && (r.data as Session).user ? (r.data as Session) : null;
}
