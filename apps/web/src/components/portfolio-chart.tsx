"use client";

import { useMemo } from "react";
import { useChartTimeZone } from "@/components/chart-timezone-context";

export type PortfolioChartPoint = {
  label: string;
  value: number;
  /** ISO timestamp of the underlying decision/snapshot, when known. */
  timestamp?: string | null;
};

/** Selected dashboard time range. Mirrors the literals in dashboard-client. */
export type ChartRange = "1H" | "1D" | "1W" | "1M";

const chartFrame = {
  width: 1000,
  height: 420,
  top: 10,
  right: 20,
  bottom: 38,
  left: 20,
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

type AxisTick = {
  /** Horizontal fraction across the plotted line (0 = first point, 1 = last). */
  fraction: number;
  text: string;
  anchor: "start" | "middle" | "end";
};

/**
 * Build time-axis ticks from the real timestamps carried by the data points.
 * The portfolio line is plotted by index, so a tick at fraction `f` maps to the
 * fractional index `f * (n - 1)`; we linearly interpolate the timestamp at that
 * index from whatever timestamps are present. Labels are formatted in the
 * selected time zone, switching between HH:mm and "d MMM" based on the span —
 * the same hour/minute distribution idea charting tools use.
 */
function buildAxisTicks(data: PortfolioChartPoint[], timeZone: string, count: number, range?: ChartRange): AxisTick[] {
  const n = data.length;
  if (n < 2) {
    return [];
  }

  const indexed = data
    .map((point, index) => ({ index, time: point.timestamp ? Date.parse(point.timestamp) : Number.NaN }))
    .filter((entry) => Number.isFinite(entry.time));

  if (indexed.length < 2) {
    return [];
  }

  const firstTime = indexed[0].time;
  const lastTime = indexed.at(-1)!.time;
  const spanMs = Math.abs(lastTime - firstTime);

  // Format granularity follows the SELECTED range, not just the data span.
  // Week/Month always show the date; if the underlying data only covers part of
  // a day we append the time so the ticks stay distinct instead of repeating the
  // same date. Hour/Day (and the unknown fallback) show HH:mm.
  const wantsDate = range === "1W" || range === "1M";
  let options: Intl.DateTimeFormatOptions;
  if (wantsDate) {
    options =
      spanMs >= 2 * DAY_MS
        ? { day: "2-digit", month: "short" }
        : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false };
  } else if (range === undefined && spanMs > 2 * DAY_MS) {
    options = { day: "2-digit", month: "short" };
  } else {
    options = { hour: "2-digit", minute: "2-digit", hour12: false };
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
  } catch {
    formatter = new Intl.DateTimeFormat("en-GB", options);
  }

  const timeAtIndex = (targetIndex: number): number => {
    if (targetIndex <= indexed[0].index) {
      return indexed[0].time;
    }
    if (targetIndex >= indexed.at(-1)!.index) {
      return indexed.at(-1)!.time;
    }
    for (let k = 1; k < indexed.length; k += 1) {
      if (targetIndex <= indexed[k].index) {
        const a = indexed[k - 1];
        const b = indexed[k];
        const frac = b.index === a.index ? 0 : (targetIndex - a.index) / (b.index - a.index);
        return a.time + (b.time - a.time) * frac;
      }
    }
    return indexed.at(-1)!.time;
  };

  const ticks: AxisTick[] = [];
  for (let i = 0; i < count; i += 1) {
    const fraction = count === 1 ? 0.5 : i / (count - 1);
    const time = timeAtIndex(fraction * (n - 1));
    const anchor: AxisTick["anchor"] = i === 0 ? "start" : i === count - 1 ? "end" : "middle";
    ticks.push({ fraction, text: formatter.format(new Date(time)), anchor });
  }
  return ticks;
}

export function PortfolioChart({
  data,
  variant = "desktop",
  timeZone: timeZoneProp,
  range,
}: {
  data: PortfolioChartPoint[];
  variant?: "desktop" | "mobile";
  timeZone?: string;
  range?: ChartRange;
}) {
  const contextTimeZone = useChartTimeZone().timeZone;
  const timeZone = timeZoneProp ?? contextTimeZone;
  const chart = useMemo(() => buildChartPaths(data), [data]);
  const isMobile = variant === "mobile";
  const gridColumns = isMobile ? 6 : 12;
  const gridRows = isMobile ? 8 : 7;

  const innerWidth = chartFrame.width - chartFrame.left - chartFrame.right;
  const desktopTicks = useMemo(
    () => (isMobile ? [] : buildAxisTicks(data, timeZone, 6, range)),
    [data, timeZone, isMobile, range],
  );
  const mobileTicks = useMemo(
    () => (isMobile ? buildAxisTicks(data, timeZone, 3, range) : []),
    [data, timeZone, isMobile, range],
  );

  const tickX = (fraction: number) => {
    const raw = chartFrame.left + fraction * innerWidth;
    // Keep edge labels off the frame edges so they never clip.
    return Math.min(Math.max(raw, chartFrame.left + 2), chartFrame.width - chartFrame.right - 2);
  };

  const chartSvg = (
    <svg
      className="block h-full min-h-0 w-full flex-1 overflow-visible"
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

      {!isMobile && desktopTicks.length > 0 ? (
        <g className="font-mono text-[11px] fill-[#8A8A8A]">
          {desktopTicks.map((tick, index) => (
            <text key={`tick-${index}`} x={tickX(tick.fraction)} y={chartFrame.height - 12} textAnchor={tick.anchor}>
              {tick.text}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );

  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        {chartSvg}
        {mobileTicks.length > 0 ? (
          <div
            aria-hidden
            className="flex shrink-0 items-center justify-between px-1 pt-2 font-mono text-[12px] font-medium tabular-nums tracking-wide text-[#D4D4D4]"
          >
            {mobileTicks.map((tick, index) => (
              <span key={`mtick-${index}`}>{tick.text}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return <div className="flex h-full min-h-0 w-full flex-1 flex-col">{chartSvg}</div>;
}
