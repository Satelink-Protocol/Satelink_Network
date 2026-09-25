import type { BusinessStatus } from "@/content/businesses";

const styles: Record<BusinessStatus, string> = {
  Operating: "bg-green-soft text-green",
  "Registered capability": "bg-ivory-2 text-stone-4",
  Planned: "bg-amber-soft text-amber-ink",
};

export function StatusBadge({ status }: { status: BusinessStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
