// /academy/courses/[slug] — no courses published yet; every slug 404s.
import { notFound } from "next/navigation";
import { COURSES } from "@/lib/academy";

export function generateStaticParams() {
  return COURSES.map((c) => ({ slug: c.slug }));
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  await params;
  notFound();
}
