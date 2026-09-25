import { me } from "./account";
import type { Onboarding } from "./onboarding";

export function onboardingEnabled() {
  return process.env.CONSOLE_ONBOARDING_V1 === "true";
}
export const loadOnboarding = () => me<Onboarding>("/onboarding");
