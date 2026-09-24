import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { fingerprint, getActiveKey, getKeys } from "@/lib/keys";
import { getSession } from "@/lib/session";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const keys = await getKeys();
  const active = await getActiveKey();
  const theme = (await cookies()).get("slc_theme")?.value === "light" ? "light" : "dark";
  return (
    <Shell
      user={{ name: session.user.name, email: session.user.email }}
      keys={keys.map((k) => ({ fp: fingerprint(k.k), label: k.label }))}
      activeFp={active ? fingerprint(active.k) : null}
      theme={theme}
    >
      {children}
    </Shell>
  );
}
