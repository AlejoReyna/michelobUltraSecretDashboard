"use client";

import { useMemo } from "react";

export type PortfolioChartPoint = {
  label: string;
  value: number;
};

const chartFrame = {
  width: 1000,
  height: 420,
  top: 26,
  right: 20,
  bottom: 38,
  left: 20,
};

function buildChartPaths(data: PortfolioChartPoint[]) {
  const values = data.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerWidth = chartFrame.width - chartFrame.left - chartFrame.right;
  const innerHeight = chartFrame.height - chartFrame.top - chartFrame.bottom;
  const bottomY = chartFrame.top + innerHeight;

  const points = data.map((point, index) => {
    const x = chartFrame.left + (index / Math.max(data.length - 1, 1)) * innerWidth;
    const y = chartFrame.top + (1 - (point.value - min) / range) * innerHeight;
    return { ...point, x, y };
  });

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${points.at(-1)?.x.toFixed(2) ?? chartFrame.left} ${bottomY} L ${points[0]?.x.toFixed(2) ?? chartFrame.left} ${bottomY} Z`;

  return { areaPath, linePath, points, bottomY };
}

export function PortfolioChart({
  data,
  variant = "desktop",
}: {
  data: PortfolioChartPoint[];
  variant?: "desktop" | "mobile";
}) {
  const chart = useMemo(() => buildChartPaths(data), [data]);
  const isMobile = variant === "mobile";
  const gridColumns = isMobile ? 6 : 12;
  const gridRows = isMobile ? 4 : 7;

  const chartSvg = (
    <svg
      className={isMobile ? "block min-h-0 w-full flex-1" : "block size-full overflow-visible"}
      viewBox={`0 0 ${chartFrame.width} ${chartFrame.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Portfolio trend chart"
    >
      <defs>
        <linearGradient id={`portfolio-fill-${variant}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#00FF00" stopOpacity="0.3" />
          <stop offset="52%" stopColor="#00FF00" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
        <filter id={`portfolio-glow-${variant}`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {Array.from({ length: gridColumns + 1 }).map((_, index) => {
        const x = chartFrame.left + (index / gridColumns) * (chartFrame.width - chartFrame.left - chartFrame.right);
        return <line key={`x-${index}`} x1={x} x2={x} y1={chartFrame.top} y2={chart.bottomY} stroke="#151515" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}
      {Array.from({ length: gridRows + 1 }).map((_, index) => {
        const y = chartFrame.top + (index / gridRows) * (chart.bottomY - chartFrame.top);
        return <line key={`y-${index}`} x1={chartFrame.left} x2={chartFrame.width - chartFrame.right} y1={y} y2={y} stroke="#151515" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}

      <path d={chart.areaPath} fill={`url(#portfolio-fill-${variant})`} />
      <path d={chart.linePath} fill="none" stroke="#00FF00" strokeWidth={isMobile ? 2.8 : 2.4} vectorEffect="non-scaling-stroke" filter={`url(#portfolio-glow-${variant})`} />
      <line x1={chartFrame.left} x2={chartFrame.width - chartFrame.right} y1={chart.bottomY} y2={chart.bottomY} stroke="#2A2A2A" strokeWidth="1" vectorEffect="non-scaling-stroke" />

      {!isMobile ? (
        <g className="font-mono text-[11px] fill-[#8A8A8A]">
          <text x={chartFrame.left + 8} y={chartFrame.height - 12}>00:00</text>
          <text x={chartFrame.width * 0.32} y={chartFrame.height - 12}>06:00</text>
          <text x={chartFrame.width * 0.58} y={chartFrame.height - 12}>12:00</text>
          <text x={chartFrame.width * 0.82} y={chartFrame.height - 12}>18:00</text>
          <text x={chartFrame.width - chartFrame.right - 54} y={chartFrame.height - 12}>24:00</text>
        </g>
      ) : null}
    </svg>
  );

  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        {chartSvg}
        <div
          aria-hidden
          className="flex shrink-0 items-center justify-between px-1 pt-2 font-mono text-[12px] font-medium tabular-nums tracking-wide text-[#D4D4D4]"
        >
          <span>00:00</span>
          <span>12:00</span>
          <span>24:00</span>
        </div>
      </div>
    );
  }

  return chartSvg;
}
