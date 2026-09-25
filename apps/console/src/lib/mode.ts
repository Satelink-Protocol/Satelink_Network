import { cookies } from "next/headers";
import { loadSettings } from "./v2";

/** Simple (default for new accounts) or Advanced — account setting, cookie-mirrored. */
export async function getMode(): Promise<"simple" | "advanced"> {
  const c = (await cookies()).get("slc_mode")?.value;
  if (c === "simple" || c === "advanced") return c;
  const s = await loadSettings();
  return s.ok ? s.data.defaultMode : "simple";
}
