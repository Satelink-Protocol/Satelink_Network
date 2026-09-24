// /customer-stories/[slug] — no stories are published yet, so every slug 404s
// until a real one exists. No fabricated stories.
import { notFound } from "next/navigation";
import { CUSTOMER_STORIES } from "@/lib/resources";

export function generateStaticParams() {
  return CUSTOMER_STORIES.map((p) => ({ slug: p.slug }));
}

export default async function CustomerStory({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  notFound();
}
