import { Construction } from "lucide-react";
import { EmptyState } from "@satelink/ui";

export function AdminComingSoon({ feature }: { feature: string }) {
  return (
    <EmptyState
      icon={Construction}
      title="Coming Soon"
      description={`${feature} requires a backend endpoint that isn't wired to Postgres in production yet.`}
    />
  );
}
