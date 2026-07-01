"use client";

import * as React from "react";
import { ChevronRight, Search, type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./ui/sidebar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { STATE_META, type SystemState } from "../tokens";

export interface ShellNavItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string | number;
}

export interface ShellNavGroup {
  label?: string;
  items: ShellNavItem[];
}

export interface ShellSearchItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  group?: string;
}

export interface DashboardShellProps {
  brand: { name: string; sublabel?: string; logo?: LucideIcon };
  nav: ShellNavGroup[];
  activeId: string;
  onNavigate: (id: string) => void;

  breadcrumb?: string[];
  /** Page heading rendered inside the content container. */
  title?: string;
  subtitle?: string;
  /** Right-aligned page actions (selectors, buttons). */
  actions?: React.ReactNode;

  /** Command palette items (⌘K / header search). */
  search?: {
    items: ShellSearchItem[];
    onSelect: (id: string) => void;
    placeholder?: string;
  };
  /** Right side of the sticky header (status, theme toggle, avatar). */
  headerRight?: React.ReactNode;
  /** KPI strip rendered at the top of the content area. */
  kpis?: React.ReactNode;

  /** Environment label chip in the header. Defaults to "Production". */
  env?: string;
  /**
   * System-health dot next to the env chip. Wire this to a REAL health
   * endpoint — it defaults to "unknown" (zinc), never a guessed green.
   */
  health?: SystemState;
  /** Last successful data refresh; renders "Updated HH:MM:SS". */
  refreshedAt?: number | null;

  /** Render the content container edge-to-edge for NOC layouts. */
  fullWidth?: boolean;
  children: React.ReactNode;
}

function CommandSearch({
  search,
}: {
  search: NonNullable<DashboardShellProps["search"]>;
}) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const groups = React.useMemo(() => {
    const map = new Map<string, ShellSearchItem[]>();
    for (const item of search.items) {
      const g = item.group ?? "Navigation";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(item);
    }
    return Array.from(map.entries());
  }, [search.items]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 w-full justify-start gap-2 px-2.5 text-muted-foreground sm:w-56 md:w-64"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left text-xs">
          {search.placeholder ?? "Search…"}
        </span>
        <kbd className="pointer-events-none hidden h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
          ⌘K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={search.placeholder ?? "Search…"} />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {groups.map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.label}
                    onSelect={() => {
                      setOpen(false);
                      search.onSelect(item.id);
                    }}
                  >
                    {Icon ? <Icon /> : null}
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

/**
 * Modern dashboard shell shared by OS and Admin: collapsible (icon) sidebar,
 * sticky header with command search + breadcrumb, optional KPI strip, and a
 * max-width content container. Applies the `.satelink-os` token scope so the
 * whole surface shares one visual language. Replaces the legacy AppShell.
 */
export function DashboardShell({
  brand,
  nav,
  activeId,
  onNavigate,
  breadcrumb,
  title,
  subtitle,
  actions,
  search,
  headerRight,
  kpis,
  env = "Production",
  health = "unknown",
  refreshedAt,
  fullWidth,
  children,
}: DashboardShellProps) {
  const BrandLogo = brand.logo;
  const healthMeta = STATE_META[health];
  return (
    <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="satelink-os h-svh overflow-hidden">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              {BrandLogo ? <BrandLogo className="size-4" /> : (
                <span className="text-xs font-bold">S</span>
              )}
            </div>
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold">{brand.name}</span>
              {brand.sublabel ? (
                <span className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                  {brand.sublabel}
                </span>
              ) : null}
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {nav.map((group, gi) => (
            <SidebarGroup key={group.label ?? gi}>
              {group.label ? (
                <SidebarGroupLabel className={cn("text-[10px] font-semibold uppercase tracking-widest text-muted-foreground", gi === 0 ? "pt-4" : "pt-6")}>
                  {group.label}
                </SidebarGroupLabel>
              ) : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === activeId}
                          tooltip={item.label}
                          onClick={() => onNavigate(item.id)}
                          className="cursor-pointer transition-colors duration-200 border-l-2 border-transparent hover:bg-muted/50 data-[active=true]:border-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-medium"
                        >
                          {Icon ? <Icon /> : null}
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {item.badge != null ? (
                          <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <div className="px-2 py-1 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
            Satelink Design System v2
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        {/* topbar — pinned above the scroll region */}
        <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 h-5" />
          {breadcrumb && breadcrumb.length > 0 ? (
            <nav className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              {breadcrumb.map((crumb, i) => (
                <React.Fragment key={`${crumb}-${i}`}>
                  {i > 0 ? <ChevronRight className="size-3.5 opacity-50" /> : null}
                  <span
                    className={
                      i === breadcrumb.length - 1
                        ? "font-medium text-foreground"
                        : undefined
                    }
                  >
                    {crumb}
                  </span>
                </React.Fragment>
              ))}
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            {search ? <CommandSearch search={search} /> : null}
            
            <div className="flex items-center gap-2 border-l border-border pl-3">
              {refreshedAt ? (
                <span className="numeric hidden text-[10px] text-muted-foreground md:inline">
                  Updated{" "}
                  {new Date(refreshedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              ) : null}

              {/* env chip + system-health dot — health defaults to unknown
                  (zinc) until a real health signal is wired in. */}
              <div
                className="hidden h-8 items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 text-xs font-medium sm:flex"
                title={`System health: ${healthMeta.label}`}
              >
                <span className={cn("size-2 rounded-full", healthMeta.bgClass)} />
                <span>{env}</span>
              </div>

              {headerRight}
            </div>
          </div>
        </header>

        {/* scroll region — owns vertical overflow so the shell fills the viewport */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* content container */}
          <div className={cn("flex flex-col gap-6 p-4 sm:p-6 mx-auto w-full animate-fade-in", fullWidth ? "max-w-[1600px]" : "max-w-7xl")}>
            {(title || actions) && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  {title ? (
                    <h1 className="text-xl font-semibold tracking-tight text-foreground">
                      {title}
                    </h1>
                  ) : null}
                  {subtitle ? (
                    <p className="text-sm text-muted-foreground">{subtitle}</p>
                  ) : null}
                </div>
                {actions ? (
                  <div className="flex items-center gap-2">{actions}</div>
                ) : null}
              </div>
            )}
            {kpis ? <div data-slot="kpi-strip">{kpis}</div> : null}
            <div className="flex flex-col gap-6">{children}</div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
