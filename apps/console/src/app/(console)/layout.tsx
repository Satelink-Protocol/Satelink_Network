import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { fingerprint, getActiveKey, getKeys } from "@/lib/keys";
import { getSession } from "@/lib/session";
import { accountsEnabled } from "@/lib/account";
import { loadSettings } from "@/lib/v2";
import { loadOnboarding, onboardingEnabled } from "@/lib/onboarding-server";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const jar = await cookies();
  const theme = jar.get("slc_theme")?.value === "light" ? "light" : "dark";
  if (accountsEnabled()) {
    if (onboardingEnabled()) {
      // First run: finish onboarding (consents, plan, spend protection) before
      // the console. If the API is unreachable we do not lock people out.
      const ob = await loadOnboarding();
      if (ob.ok && ob.data.step !== "done") redirect("/welcome");
    }
    // Console V2: mode is an account setting (cookie mirrors it for this browser).
    const cookieMode = jar.get("slc_mode")?.value;
    const settings = cookieMode === "simple" || cookieMode === "advanced" ? null : await loadSettings();
    const mode = cookieMode === "simple" || cookieMode === "advanced" ? cookieMode : settings?.ok ? settings.data.defaultMode : "simple";
    return (
      <Shell mode={mode} user={{ name: session.user.name, email: session.user.email }} keys={[]} activeFp={null} theme={theme}>
        {children}
      </Shell>
    );
  }
  const keys = await getKeys();
  const active = await getActiveKey();
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
