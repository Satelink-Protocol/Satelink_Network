"use client";
// Client wrapper that gives the presentational SearchPalette a real search
// function (a fetch to /api/search). Passed into MegaMenuHeader's `search` slot.
import { SearchPalette, type SearchHit } from "@satelink/web-ui";

async function search(q: string): Promise<SearchHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { hits?: SearchHit[] };
  return data.hits ?? [];
}

export function SiteSearch() {
  return <SearchPalette search={search} />;
}
