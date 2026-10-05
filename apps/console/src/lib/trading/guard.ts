// Stage 25 — every /trading page is invisible (404) unless CONSOLE_AGENT_IA is on (layer 5).
import { notFound } from "next/navigation";
import { agentIaEnabled } from "./flags";

export function requireAgentIa(): void {
  if (!agentIaEnabled()) notFound();
}
