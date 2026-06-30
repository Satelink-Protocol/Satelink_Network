import * as React from "react";
import { cn } from "../../lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

export interface HeatmapPanelProps {
  title: string;
  data: number[][]; // [row][col]
  xLabels?: string[];
  yLabels?: string[];
  colorScale?: "teal" | "redgreen" | "blues";
  height?: number;
  loading?: boolean;
  className?: string;
}

export function HeatmapPanel({
  title,
  data,
  xLabels,
  yLabels,
  colorScale = "teal",
  height = 300,
  loading = false,
  className,
}: HeatmapPanelProps) {
  // Find min/max for scaling
  const { min, max } = React.useMemo(() => {
    let currentMin = Infinity;
    let currentMax = -Infinity;
    data.forEach((row) => {
      row.forEach((val) => {
        if (val < currentMin) currentMin = val;
        if (val > currentMax) currentMax = val;
      });
    });
    
    // Fallback if empty or single value
    if (currentMin === Infinity) currentMin = 0;
    if (currentMax === -Infinity || currentMin === currentMax) currentMax = currentMin > 0 ? currentMin : 1;
    
    return { min: currentMin, max: currentMax };
  }, [data]);

  const numRows = data.length;
  const numCols = numRows > 0 ? data[0].length : 0;

  // Function to get color based on value and scale
  const getCellColor = (value: number) => {
    // Normalize value between 0 and 1
    const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));
    
    if (value === 0 && colorScale !== "redgreen") {
      return "transparent";
    }

    if (colorScale === "teal") {
      // Teal: hsl(174 80% 38%) -> --primary
      // Fade opacity based on value
      return `hsla(174, 80%, 38%, ${0.1 + normalized * 0.9})`;
    } 
    else if (colorScale === "redgreen") {
      // Green for low, Red for high
      // Interpolate between success (hsl 152 65% 38%) and destructive (hsl 0 72% 42%)
      const hue = 152 - (normalized * 152); 
      return `hsla(${hue}, 70%, 40%, 0.8)`;
    } 
    else {
      // Blues
      return `hsla(210, 100%, 50%, ${0.1 + normalized * 0.9})`;
    }
  };

  // Gradient string for the legend
  const legendGradient = React.useMemo(() => {
    if (colorScale === "teal") {
      return "linear-gradient(to right, hsla(174, 80%, 38%, 0.1), hsla(174, 80%, 38%, 1))";
    } else if (colorScale === "redgreen") {
      return "linear-gradient(to right, hsla(152, 70%, 40%, 0.8), hsla(0, 70%, 40%, 0.8))";
    } else {
      return "linear-gradient(to right, hsla(210, 100%, 50%, 0.1), hsla(210, 100%, 50%, 1))";
    }
  }, [colorScale]);

  return (
    <Card className={cn("overflow-hidden panel-hover", className)}>
      <CardHeader className="pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div 
          className="relative flex flex-col w-full" 
          style={{ minHeight: height }}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 rounded">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : numRows === 0 || numCols === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded bg-muted/10">
              No data available
            </div>
          ) : (
            <>
              <div className="flex flex-1 overflow-hidden">
                {/* Y-Axis Labels */}
                {yLabels && yLabels.length === numRows && (
                  <div className="flex flex-col justify-around pr-2 shrink-0 h-full overflow-hidden">
                    {yLabels.map((label, i) => (
                      <div 
                        key={i} 
                        className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider text-right truncate max-w-[80px]"
                        title={label}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Heatmap Grid */}
                <div className="flex-1 flex flex-col min-w-0">
                  <div 
                    className="flex-1 grid gap-[2px]" 
                    style={{ 
                      gridTemplateRows: `repeat(${numRows}, minmax(0, 1fr))`,
                      gridTemplateColumns: `repeat(${numCols}, minmax(0, 1fr))`
                    }}
                  >
                    <TooltipProvider delayDuration={100}>
                      {data.map((row, rowIndex) => (
                        row.map((val, colIndex) => (
                          <Tooltip key={`${rowIndex}-${colIndex}`}>
                            <TooltipTrigger asChild>
                              <div 
                                className="w-full h-full rounded-[1px] cursor-pointer hover:ring-1 hover:ring-foreground transition-all duration-100 min-h-[12px] min-w-[12px]"
                                style={{ 
                                  backgroundColor: getCellColor(val),
                                  // Add subtle border to transparent cells to see the grid
                                  border: (val === 0 && colorScale !== "redgreen") ? '1px solid hsl(var(--border) / 0.3)' : 'none'
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent 
                              className="text-[11px] font-mono border-border bg-popover shadow-xl"
                            >
                              <div className="flex flex-col gap-1">
                                {yLabels && <span>Y: {yLabels[rowIndex]}</span>}
                                {xLabels && <span>X: {xLabels[colIndex]}</span>}
                                <span className="font-bold text-foreground">Value: {val}</span>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ))
                      ))}
                    </TooltipProvider>
                  </div>
                  
                  {/* X-Axis Labels */}
                  {xLabels && xLabels.length === numCols && (
                    <div 
                      className="grid gap-[2px] mt-1 pt-1 border-t border-border/30"
                      style={{ gridTemplateColumns: `repeat(${numCols}, minmax(0, 1fr))` }}
                    >
                      {xLabels.map((label, i) => (
                        <div 
                          key={i} 
                          className="text-[9px] text-muted-foreground font-mono uppercase truncate text-center"
                          // Only show every Nth label if there are too many columns
                          style={{ opacity: (numCols > 20 && i % Math.ceil(numCols/10) !== 0) ? 0 : 1 }}
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Legend */}
              <div className="mt-4 flex items-center justify-between text-[10px] text-muted-foreground font-mono pt-2 border-t border-border/50">
                <span>{min.toFixed(0)}</span>
                <div 
                  className="h-2 w-48 rounded-full shadow-inner mx-4"
                  style={{ background: legendGradient }}
                />
                <span>{max.toFixed(0)}</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
