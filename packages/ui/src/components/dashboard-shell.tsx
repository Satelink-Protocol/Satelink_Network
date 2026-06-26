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
  fullWidth,
  children,
}: DashboardShellProps) {
  const BrandLogo = brand.logo;
  return (
    <SidebarProvider className="satelink-os">
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
                <span className="truncate text-xs text-muted-foreground">
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
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
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
                          className="transition-colors duration-200 hover:bg-muted/50 data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
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

      <SidebarInset>
        {/* sticky header */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border glass-panel px-4 backdrop-blur-md">
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
              <Button variant="ghost" size="icon" className="relative size-8">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" />
              </Button>
              
              <div className="hidden h-8 items-center gap-2 rounded-md border border-border bg-muted/50 px-2 text-xs font-medium sm:flex">
                <div className="size-2 rounded-full bg-success animate-pulse" />
                <select className="bg-transparent outline-none ring-0 appearance-none cursor-pointer">
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                </select>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="m6 9 6 6 6-6"/></svg>
              </div>

              {headerRight}

              <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground ring-1 ring-border">
                AD
              </div>
            </div>
          </div>
        </header>

        {/* content container */}
        <div className={cn("flex flex-1 flex-col gap-4 p-4 mx-auto w-full animate-fade-in", fullWidth ? "max-w-full" : "max-w-[1800px]")}>
          {(title || actions) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-2">
              <div className="space-y-1">
                {title ? (
                  <h1 className="text-lg font-semibold tracking-tight text-foreground uppercase">
                    {title}
                  </h1>
                ) : null}
                {subtitle ? (
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex items-center gap-2">{actions}</div>
              ) : null}
            </div>
          )}
          {kpis ? <div data-slot="kpi-strip" className="-mx-2 px-2 overflow-x-auto pb-2">{kpis}</div> : null}
          <div className="flex flex-col gap-4">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
