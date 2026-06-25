import React, { type ReactNode, type ChangeEvent } from 'react';
import { Search } from 'lucide-react';

export interface FilterPanelProps {
  children?: ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  showDateRange?: boolean;
  showEnvironment?: boolean;
  showChain?: boolean;
  showNode?: boolean;
  showSeverity?: boolean;
  severityValue?: string;
  onSeverityChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
}

export function FilterPanel({
  children,
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,
  showDateRange,
  showEnvironment,
  showChain,
  showNode,
  showSeverity,
  severityValue,
  onSeverityChange,
}: FilterPanelProps): JSX.Element {
  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between bg-card border border-border p-3 rounded-lg">
      <div className="flex flex-col sm:flex-row gap-2 w-full lg:max-w-xl">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={onSearchChange}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-muted/40 border border-border rounded-md text-foreground focus:outline-none focus:border-primary placeholder-muted-foreground font-mono min-w-0"
          />
        </div>

        {showSeverity && (
          <select
            value={severityValue}
            onChange={onSeverityChange}
            className="text-xs bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary shrink-0 min-w-[105px]"
          >
            <option value="ALL">ALL LEVELS</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>
        )}

        {/* Placeholders for standard filters that might be expanded later */}
        {showEnvironment && (
          <select className="text-xs bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary shrink-0 min-w-[105px]">
            <option value="all">All Environments</option>
            <option value="prod">Production</option>
            <option value="stage">Staging</option>
          </select>
        )}
        
        {showChain && (
          <select className="text-xs bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary shrink-0 min-w-[105px]">
            <option value="all">All Chains</option>
            <option value="polygon">Polygon</option>
            <option value="ethereum">Ethereum</option>
          </select>
        )}

        {showNode && (
          <select className="text-xs bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary shrink-0 min-w-[105px]">
            <option value="all">All Nodes</option>
            <option value="active">Active Only</option>
          </select>
        )}
      </div>

      {children && (
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {children}
        </div>
      )}
    </div>
  );
}
