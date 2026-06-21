"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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

// Left gutter reserved for the dollar (Y) axis labels, per variant.
const yAxisGutter = {
  desktop: 64,
  mobile: 44,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Round a span to a human-friendly magnitude (1, 2, 5 × 10^n) so the dollar
 * axis lands on tidy values instead of arbitrary data extremes. This is the
 * standard "nice number" algorithm charting libraries use.
 */
function niceNum(range: number, round: boolean): number {
  const safeRange = range > 0 ? range : 1;
  const exponent = Math.floor(Math.log10(safeRange));
  const fraction = safeRange / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return niceFraction * 10 ** exponent;
}

/**
 * Build a money-based Y domain from the data: pad the real min/max so the line
 * never hugs the frame edges, then snap to nice rounded dollar bounds and a
 * round step. This is what makes the line read like a normal portfolio chart
 * (proportionate movement against a real $ scale) instead of noise stretched
 * edge-to-edge. A single low/high outlier just sets sensible bounds rather than
 * crushing every other point flat.
 */
function buildDollarScale(values: number[], baseline: number, desiredTicks = 5) {
  const min = Math.min(...values, baseline);
  const max = Math.max(...values, baseline);
  const basis = max - min || Math.abs(max) || 1;
  const pad = basis * 0.12;
  const paddedMin = min - pad;
  const paddedMax = max + pad;

  const span = niceNum(paddedMax - paddedMin, false);
  const step = niceNum(span / Math.max(desiredTicks - 1, 1), true);
  let lo = Math.floor(paddedMin / step) * step;
  let hi = Math.ceil(paddedMax / step) * step;
  if (min >= 0 && lo < 0) {
    lo = 0;
  }
  if (hi <= lo) {
    hi = lo + step;
  }

  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }

  return { lo, hi, step, ticks };
}

/** Default starting balance used when no initial balance can be detected. */
const DEFAULT_INITIAL_BALANCE = 10;

type ChartFrame = {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function buildChartPaths(data: PortfolioChartPoint[], leftMargin: number, initialBalance?: number, frame?: ChartFrame) {
  const f = frame ?? chartFrame;
  const values = data.map((point) => point.value);
  const detectedInitial = data[0]?.value;
  const baseline = initialBalance ?? detectedInitial ?? DEFAULT_INITIAL_BALANCE;
  const scale = buildDollarScale(values, baseline);
  const range = scale.hi - scale.lo || 1;
  const innerWidth = f.width - f.left - f.right;
  const innerHeight = f.height - f.top - f.bottom;
  const bottomY = f.top + innerHeight;

  const points = data.map((point, index) => {
    const x = f.left + (index / Math.max(data.length - 1, 1)) * innerWidth;
    const y = f.top + (1 - (point.value - scale.lo) / range) * innerHeight;
    return { ...point, x, y };
  });

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${points.at(-1)?.x.toFixed(2) ?? f.left} ${bottomY} L ${points[0]?.x.toFixed(2) ?? f.left} ${bottomY} Z`;

  const yForValue = (value: number) => f.top + (1 - (value - scale.lo) / range) * innerHeight;

  return { areaPath, linePath, points, bottomY, scale, yForValue, leftMargin: f.left, baseline };
}

/** Format a dollar value for the Y axis, compact for large balances. */
function formatAxisMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  }
  if (abs >= 100) {
    return `$${value.toFixed(0)}`;
  }
  if (abs >= 10) {
    return `$${value.toFixed(1)}`;
  }
  return `$${value.toFixed(2)}`;
}

type AxisTick = {
  fraction: number;
  text: string;
  anchor: "start" | "middle" | "end";
};

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
  initialBalance,
  experimental: _experimental = true,
}: {
  data: PortfolioChartPoint[];
  variant?: "desktop" | "mobile";
  timeZone?: string;
  range?: ChartRange;
  initialBalance?: number;
  experimental?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: chartFrame.width, height: chartFrame.height });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const rect = el.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setDimensions({ width: cr.width, height: cr.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const contextTimeZone = useChartTimeZone().timeZone;
  const timeZone = timeZoneProp ?? contextTimeZone;
  const isMobile = variant === "mobile";
  const leftMargin = isMobile ? yAxisGutter.mobile : yAxisGutter.desktop;

  const frame: ChartFrame = useMemo(() => {
    const { width, height } = dimensions;
    return {
      width: Math.max(width, 200),
      height: Math.max(height, 120),
      top: 0,
      right: 12,
      bottom: 32,
      left: leftMargin,
    };
  }, [dimensions, leftMargin]);

  const chart = useMemo(
    () => buildChartPaths(data, leftMargin, initialBalance, frame),
    [data, leftMargin, initialBalance, frame],
  );

  const gridColumns = isMobile ? 6 : 12;
  const innerWidth = frame.width - frame.left - frame.right;

  const desktopTicks = useMemo(
    () => (isMobile ? [] : buildAxisTicks(data, timeZone, 6, range)),
    [data, timeZone, isMobile, range],
  );
  const mobileTicks = useMemo(
    () => (isMobile ? buildAxisTicks(data, timeZone, 3, range) : []),
    [data, timeZone, isMobile, range],
  );

  const tickX = (fraction: number) => {
    const raw = frame.left + fraction * innerWidth;
    return Math.min(Math.max(raw, frame.left + 2), frame.width - frame.right - 2);
  };

  const yTicks = chart.scale.ticks;

  const lineColor = isMobile ? "#00FF00" : "#FFFFFF";
  const fillColor = isMobile ? "#00FF00" : "#B8B8B8";

  const chartSvg = (
    <svg
      className="block h-full min-h-0 w-full flex-1 overflow-visible"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Portfolio trend chart"
    >
      <defs>
        <linearGradient id={`portfolio-fill-${variant}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fillColor} stopOpacity={isMobile ? 0.3 : 0.18} />
          <stop offset="52%" stopColor={fillColor} stopOpacity={isMobile ? 0.12 : 0.07} />
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
        const x = frame.left + (index / gridColumns) * (frame.width - frame.left - frame.right);
        return <line key={`x-${index}`} x1={x} x2={x} y1={frame.top} y2={chart.bottomY} stroke="#151515" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}
      {/* Horizontal gridlines aligned to the dollar ticks. */}
      {yTicks.map((value, index) => {
        const y = chart.yForValue(value);
        return <line key={`y-${index}`} x1={frame.left} x2={frame.width - frame.right} y1={y} y2={y} stroke="#151515" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}

      {/* Dollar (Y) axis labels. */}
      <g className="font-mono text-[11px] fill-[#8A8A8A]">
        {yTicks.map((value, index) => {
          const y = chart.yForValue(value);
          return (
            <text key={`ylabel-${index}`} x={frame.left - 8} y={y + 3.5} textAnchor="end">
              {formatAxisMoney(value)}
            </text>
          );
        })}
      </g>

      {/* Initial-balance reference: the chart is framed from the starting capital. */}
      <line
        x1={frame.left}
        x2={frame.width - frame.right}
        y1={chart.yForValue(chart.baseline)}
        y2={chart.yForValue(chart.baseline)}
        stroke="#3A3A3A"
        strokeWidth="1"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />

      <path d={chart.areaPath} fill={`url(#portfolio-fill-${variant})`} />
      <path d={chart.linePath} fill="none" stroke={lineColor} strokeWidth={isMobile ? 2.8 : 2.4} vectorEffect="non-scaling-stroke" filter={`url(#portfolio-glow-${variant})`} />
      <line x1={frame.left} x2={frame.width - frame.right} y1={chart.bottomY} y2={chart.bottomY} stroke="#2A2A2A" strokeWidth="1" vectorEffect="non-scaling-stroke" />

      {!isMobile && desktopTicks.length > 0 ? (
        <g className="font-mono text-[11px] fill-[#8A8A8A]">
          {desktopTicks.map((tick, index) => (
            <text key={`tick-${index}`} x={tickX(tick.fraction)} y={frame.height - 12} textAnchor={tick.anchor}>
              {tick.text}
            </text>
          ))}
        </g>
      ) : null}
    </svg>
  );

  if (isMobile) {
    return (
      <div ref={containerRef} className="flex h-full flex-col">
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

  return <div ref={containerRef} className="flex h-full min-h-0 w-full flex-1 flex-col">{chartSvg}</div>;
}
