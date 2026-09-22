"use client";
// PricingAudienceTabs (§4.6) — Individuals · Agents & API · Enterprise (greyed
// "Later"). All panels are SSR-complete in the DOM (hidden when inactive) so
// anchors and SEO work. On mount, a #agents hash activates the Agents panel and
// scrolls to it (the home "Agents & API" plan card links to /pricing#agents).
import * as React from "react";

type TabId = "individuals" | "agents" | "enterprise";

const TABS: { id: TabId; label: string; muted?: boolean }[] = [
  { id: "individuals", label: "Individuals" },
  { id: "agents", label: "Agents & API" },
  { id: "enterprise", label: "Enterprise · later", muted: true },
];

export function PricingAudienceTabs({
  individuals,
  agents,
  enterprise,
}: {
  individuals: React.ReactNode;
  agents: React.ReactNode;
  enterprise: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabId>("individuals");

  React.useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#agents") {
      setTab("agents");
      // Scroll after the panel un-hides on the next frame.
      requestAnimationFrame(() =>
        document.getElementById("agents")?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    }
  }, []);

  const panels: Record<TabId, React.ReactNode> = { individuals, agents, enterprise };

  return (
    <div>
      <div role="tablist" aria-label="Pricing audience" className="mx-auto flex w-fit flex-wrap justify-center gap-1 rounded-[var(--sl-radius-pill)] border border-sl-border bg-sl-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`aud-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`aud-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`rounded-[var(--sl-radius-pill)] px-4 py-1.5 text-sm font-semibold transition-colors aria-selected:bg-sl-accent aria-selected:text-sl-accent-ink ${
              t.muted ? "text-sl-text-subtle" : "text-sl-text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`aud-panel-${t.id}`}
          aria-labelledby={`aud-tab-${t.id}`}
          hidden={tab !== t.id}
          className="mt-10"
        >
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
