import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/account";
import { AgentFlow } from "@/components/v2/AgentFlow";

export const metadata: Metadata = { title: "Give my software access" };

export default function NewAgentPage() {
  if (!accountsEnabled()) redirect("/keys?new=1");
  return <AgentFlow />;
}
