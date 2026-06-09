"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LineSpace } from "@/lib/radon-space";
import { formatUiNumber } from "@/lib/utils";

function svgNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function svgRgba(r: number, g: number, b: number, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${svgNumber(alpha)})`;
}

export function LineSpaceView({
  lineSpace,
  orderLabel,
  showRasterLayer,
}: {
  lineSpace: LineSpace;
  orderLabel: string;
  showRasterLayer: boolean;
}) {
  const width = 900;
  const height = 380;
  const margin = { top: 16, right: 16, bottom: 34, left: 44 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const cellWidth = plotWidth / lineSpace.psiBins;
  const cellHeight = plotHeight / lineSpace.pBins;
  const yForP = (p: number) => margin.top + ((1 - (p + 1) / 2) * plotHeight);
  const xForTheta = (theta: number) =>
    margin.left + (theta / lineSpace.thetaMax) * plotWidth;

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-help rounded-sm text-sm font-medium underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Radon space
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={8}
            className="block max-w-sm bg-popover p-3 text-left text-popover-foreground shadow-lg"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Maps each {orderLabel} edge chord to its normal form (θ, p), then
              counts hits in a 180 × 120 grid. White means no or few chords hit
              that cell; deeper orange means more chords share the same line
              coordinates.
            </p>
          </TooltipContent>
        </Tooltip>
        <span className="font-mono text-xs text-muted-foreground">
          total {formatUiNumber(lineSpace.totalEdgeCount)}
          {lineSpace.hasSeedWedge
            ? ` · seed ${formatUiNumber(lineSpace.seedEdgeCount)}`
            : ""}{" "}
          · used {formatUiNumber(lineSpace.usedEdgeCount)}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img">
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          fill="var(--muted)"
          fillOpacity={0.35}
        />

        {[-1, 0, 1].map((p) => (
          <g key={`p-${p}`}>
            <line
              x1={margin.left}
              y1={yForP(p)}
              x2={margin.left + plotWidth}
              y2={yForP(p)}
              stroke="var(--border)"
              strokeDasharray={p === 0 ? "4 4" : undefined}
            />
            <text
              x={margin.left - 10}
              y={yForP(p) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {p}
            </text>
          </g>
        ))}

        {[0, lineSpace.thetaMax / 2, lineSpace.thetaMax].map((theta) => (
          <g key={`theta-${theta}`}>
            <line
              x1={svgNumber(xForTheta(theta))}
              y1={margin.top}
              x2={svgNumber(xForTheta(theta))}
              y2={margin.top + plotHeight}
              stroke="var(--border)"
            />
            <text
              x={svgNumber(xForTheta(theta))}
              y={height - 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {theta === 0 ? "0" : theta === lineSpace.thetaMax ? "π" : "π/2"}
            </text>
          </g>
        ))}

        {showRasterLayer &&
          lineSpace.bins.map((bin) => {
            const opacity =
              0.12 + 0.88 * Math.sqrt(bin.count / Math.max(1, lineSpace.maxCount));
            return (
              <rect
                key={`${bin.x}-${bin.y}`}
                x={svgNumber(margin.left + bin.x * cellWidth)}
                y={svgNumber(margin.top + (lineSpace.pBins - 1 - bin.y) * cellHeight)}
                width={svgNumber(Math.max(0.75, cellWidth))}
                height={svgNumber(Math.max(0.75, cellHeight))}
                fill={svgRgba(249, 115, 22, opacity)}
              />
            );
          })}

        <text
          x={svgNumber(margin.left + plotWidth / 2)}
          y={height - 2}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          θ
        </text>
        <text
          x={14}
          y={svgNumber(margin.top + plotHeight / 2)}
          textAnchor="middle"
          transform={`rotate(-90 14 ${svgNumber(margin.top + plotHeight / 2)})`}
          className="fill-muted-foreground text-[11px]"
        >
          p
        </text>
      </svg>
    </section>
  );
}
