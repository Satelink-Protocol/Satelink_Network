"use client";
import * as React from "react";

export function NocWorldMap() {
  return (
    <div className="flex flex-col border border-border bg-card rounded-md h-full relative overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30 z-10">
        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          Global Network Traffic
        </span>
      </div>
      <div className="flex-1 relative bg-background w-full h-[200px] overflow-hidden flex items-center justify-center">
        {/* Abstract World Map SVG */}
        <svg
          viewBox="0 0 1000 500"
          className="absolute inset-0 w-full h-full opacity-30"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="2"
        >
          {/* Abstract landmasses */}
          <path d="M 200,100 Q 250,50 300,100 T 400,150 Q 350,250 250,200 Z" />
          <path d="M 500,100 Q 600,50 700,150 T 600,300 Q 550,200 450,150 Z" />
          <path d="M 750,200 Q 850,150 900,250 T 800,400 Q 700,300 750,200 Z" />
          <path d="M 150,250 Q 200,200 250,300 T 200,450 Q 100,350 150,250 Z" />
        </svg>

        {/* Nodes and Links */}
        <svg viewBox="0 0 1000 500" className="absolute inset-0 w-full h-full z-10 pointer-events-none">
          <defs>
            <style>{`
              @keyframes pulse {
                0% { r: 4; opacity: 1; stroke-width: 0; }
                100% { r: 15; opacity: 0; stroke-width: 2; }
              }
              .node-pulse {
                animation: pulse 2s infinite ease-out;
                fill: transparent;
                stroke: hsl(var(--primary, 182 100% 35%));
                transform-origin: center;
              }
              @keyframes dash {
                to { stroke-dashoffset: -20; }
              }
              .traffic-path {
                stroke-dasharray: 4, 6;
                animation: dash 1s linear infinite;
              }
            `}</style>
          </defs>

          {/* Paths */}
          <path className="traffic-path" d="M 250,150 Q 400,50 550,150" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" opacity="0.6"/>
          <path className="traffic-path" d="M 550,150 Q 650,250 800,250" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" opacity="0.6"/>
          <path className="traffic-path" d="M 250,150 Q 300,300 180,350" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.4"/>
          <path className="traffic-path" d="M 550,150 Q 500,350 750,350" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.4"/>

          {/* Nodes (NY, London, Tokyo, SF, Sydney) */}
          <g transform="translate(250, 150)">
            <circle r="4" fill="hsl(var(--primary))" />
            <circle className="node-pulse" style={{ animationDelay: '0s' }} />
          </g>
          <g transform="translate(550, 150)">
            <circle r="4" fill="hsl(var(--primary))" />
            <circle className="node-pulse" style={{ animationDelay: '0.5s' }} />
          </g>
          <g transform="translate(800, 250)">
            <circle r="4" fill="hsl(var(--primary))" />
            <circle className="node-pulse" style={{ animationDelay: '1s' }} />
          </g>
          <g transform="translate(180, 350)">
            <circle r="3" fill="hsl(var(--border))" />
          </g>
          <g transform="translate(750, 350)">
            <circle r="3" fill="hsl(var(--border))" />
          </g>
        </svg>
      </div>
    </div>
  );
}
