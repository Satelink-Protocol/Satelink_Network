// Connected API keys. Until the API links Better Auth users to api_credits
// accounts server-side (docs/console/ACCOUNT_LINKING.md), the console keeps the
// keys a signed-in user connects in an httpOnly, Secure, SameSite=Strict cookie
// scoped to the console host. The browser JS never sees a key after creation,
// and keys are never written to localStorage or sent to any third party.
import { cookies } from "next/headers";

export type ConnectedKey = { k: string; label: string; addedAt: string };

const KEYS_COOKIE = "slc_keys";
const ACTIVE_COOKIE = "slc_active";
const MAX_KEYS = 10;

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 90,
};

export async function getKeys(): Promise<ConnectedKey[]> {
  const raw = (await cookies()).get(KEYS_COOKIE)?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.k === "string").slice(0, MAX_KEYS) : [];
  } catch {
    return [];
  }
}

export async function getActiveKey(): Promise<ConnectedKey | null> {
  const keys = await getKeys();
  if (keys.length === 0) return null;
  const active = (await cookies()).get(ACTIVE_COOKIE)?.value;
  return keys.find((x) => fingerprint(x.k) === active) || keys[0];
}

export async function saveKeys(keys: ConnectedKey[]) {
  (await cookies()).set(KEYS_COOKIE, JSON.stringify(keys.slice(0, MAX_KEYS)), cookieOpts);
}

export async function setActive(fp: string) {
  (await cookies()).set(ACTIVE_COOKIE, fp, cookieOpts);
}

/** Display-safe identifier: prefix + last 4. Never render a full key. */
export function fingerprint(k: string) {
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

export { MAX_KEYS };
