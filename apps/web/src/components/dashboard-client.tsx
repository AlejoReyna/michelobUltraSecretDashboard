"use client";

import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  ExternalLink,
  Filter,
  Github,
  Globe,
  Home,
  Layers,
  Terminal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { DeviceTopSection } from "@/components/device-top-section";
import { DecisionAlgorithmPanel } from "@/components/decision-algorithm-panel";
import { MarketChatPanel } from "@/components/market-chat-panel";
import {
  ViewportReveal,
  activityCellDelay,
  activityColumnVariant,
  activityLeadEventVariant,
  activityReferenceVariant,
  activityStatusVariant,
  type ActivityFeedMode,
  homeMetricVariant,
  positionCellDelay,
  positionColumnVariant,
  positionLeadVariant,
  type PositionColumn,
  walletCellDelay,
  walletColumnVariant,
  walletRowLeadVariant,
} from "@/components/viewport-reveal";
import { PortfolioChart, type PortfolioChartPoint } from "@/components/portfolio-chart";
import { ChartTimeZoneProvider, useChartTimeZone } from "@/components/chart-timezone-context";
import { CHART_TIME_ZONES, gmtOffsetLabel, localTimeLabel } from "@/lib/timezones";
import { TokenIcon } from "@/components/token-icon";
import {
  agentModeLabel,
  boughtTokensFromTelemetry,
  competitionTokenKey,
  isQuoteAsset,
  liveWalletBalancesFromTelemetry,
  realActiveTradeCount,
  type WalletBalanceRow,
} from "@/lib/competition-tokens";
import {
  decisionActionTone,
  formatDecisionEvent,
  resolveAgentLogLine,
} from "@/lib/agent-log";
import {
  cycleCountdownMs,
  formatCycleCountdown,
  inferCycleIntervalMs,
  nextCycleAt,
} from "@/lib/cycle-timing";
import { breakoutEntryScoreStats, entryFactorStats, isComplianceDecision, resolveStrategyMode } from "@/lib/factor-scoring";
import { scalpingFactorStats } from "@/lib/scalping-scoring";
import {
  detailsFromDecision,
  detailsFromExecution,
  detailsFromMovement,
  detailsFromSellHistory,
  explainFactor,
  type LogEventDetails,
} from "@/lib/log-event-details";
import {
  statusSchema,
  type Decision,
  type MarketDataRow,
  type SellHistoryRow,
  type StatusPayload,
  type X402Call,
} from "@/lib/schemas";

type DashboardSection = "overview" | "positions" | "activity" | "wallet" | "algorithm" | "market-chat" | "x402";
type ActivityView = "txs" | "sys";

const dashboardNavItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Home", icon: Home, section: "overview" },
  { label: "Positions", icon: Layers, section: "positions" },
  { label: "Activity", icon: Activity, section: "activity" },
  { label: "Intel", icon: Terminal, section: "market-chat" },
  { label: "Wallet", icon: Wallet, section: "wallet" },
  { label: "Payments", icon: CreditCard, section: "x402" },
  { label: "Guide", icon: BookOpen, section: "algorithm" },
];

const DESKTOP_NAV_WIDTH = 56;
const defaultDeviceTopSectionColor = "#000000";
const focusedDeviceTopSectionColor = "#111111";
const focusedDeviceTopSections = new Set<DashboardSection>(["positions", "wallet", "market-chat", "x402"]);

function deviceTopSectionColorFor(section: DashboardSection) {
  return focusedDeviceTopSections.has(section) ? focusedDeviceTopSectionColor : defaultDeviceTopSectionColor;
}

function panelUsesFlatChrome(compact: boolean, desktop: boolean) {
  return compact || desktop;
}

const projectRepository = {
  owner: "AlejoReyna",
  name: "no-named-yet-bot",
  url: "https://github.com/AlejoReyna/no-named-yet-bot/tree/main",
  title: "No Named Yet Bot",
  description: "Autonomous trading bot with TWAK signing, CMC data, and strict guardrails.",
};

type DesktopNavEntry =
  | { kind: "section"; label: string; icon: LucideIcon; section: DashboardSection }
  | {
      kind: "link";
      label: string;
      icon: LucideIcon;
      href: string;
      ariaLabel: string;
    };

const desktopNavItems: DesktopNavEntry[] = [
  ...dashboardNavItems.slice(0, -1).map((item) => ({ kind: "section" as const, ...item })),
  {
    kind: "link",
    label: "Repository",
    icon: Github,
    href: projectRepository.url,
    ariaLabel: "Open AlejoReyna/NoNamedYetBot on GitHub",
  },
  { kind: "section", ...dashboardNavItems.at(-1)! },
];

const timeRanges = ["1H", "1D", "1W", "1M"] as const;
type TimeRange = (typeof timeRanges)[number];

function timeRangeDurationMs(range: TimeRange) {
  switch (range) {
    case "1H":
      return 60 * 60 * 1000;
    case "1D":
      return 24 * 60 * 60 * 1000;
    case "1W":
      return 7 * 24 * 60 * 60 * 1000;
    case "1M":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function decisionsForRange(data: StatusPayload | null, range: TimeRange) {
  const cutoff = Date.now() - timeRangeDurationMs(range);
  return (
    data?.decisions.filter((decision) => {
      const timestamp = new Date(decision.timestamp).getTime();
      return !Number.isNaN(timestamp) && timestamp >= cutoff;
    }) ?? []
  );
}

type MetricView = {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  tone?: "positive" | "negative";
  tooltip?: string;
};

type ActivityRow = {
  id: string;
  amount: string;
  narrative?: string;
  timestamp: string | null;
  token: string | null;
  hash: string;
  explorerUrl: string | null;
  status: string;
  tone: "green" | "yellow" | "red";
  details?: LogEventDetails;
};

const ACTIVITY_ROWS_PER_PAGE = 10;
const ACTIVITY_ROWS_PER_PAGE_MOBILE = 7;
const ACTIVITY_LOG_ROWS_PER_PAGE_MOBILE = 5;

type PositionRow = {
  id: string;
  symbol: string;
  source: "tracked" | "wallet";
  amount: number | null;
  entryPrice: number | null;
  entryValueUsd: number | null;
  currentPrice: number | null;
  highestPrice: number | null;
  trailingStopPrice: number | null;
  takeProfitPrice: number | null;
  openedAt: string | null;
};

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

function explorerUrlFor(chain: string | null | undefined, txHash: string | null | undefined): string | null {
  if (!txHash || !TX_HASH_RE.test(txHash)) {
    return null;
  }

  if (chain?.toLowerCase() === "base") {
    return `https://basescan.org/tx/${txHash}`;
  }

  if (chain?.toLowerCase() === "bsc") {
    return `https://bscscan.com/tx/${txHash}`;
  }

  return null;
}

function explorerUrlFromExecution(execution: StatusPayload["executions"][number]): string | null {
  const txHash =
    execution.tx_hash ?? stringFromUnknown(execution.result?.tx_hash) ?? stringFromUnknown(execution.result?.hash);
  const direct =
    stringFromUnknown(execution.explorer) ??
    stringFromUnknown(execution.result?.explorer) ??
    stringFromUnknown(execution.result?.explorerUrl) ??
    stringFromUnknown(execution.result?.explorer_url);

  if (direct) {
    return direct;
  }

  const chain = stringFromUnknown(execution.result?.chain) ?? "bsc";
  return explorerUrlFor(chain, txHash);
}

const POSITION_EXECUTION_MATCH_WINDOW_MS = 15 * 60 * 1000;

function positionExplorerUrl(
  row: PositionRow,
  executions: StatusPayload["executions"],
  walletAddress: string | null | undefined,
): string | null {
  const openedAtMs = row.openedAt ? Date.parse(row.openedAt) : Number.NaN;
  let best: { url: string; distance: number } | null = null;

  for (const execution of executions) {
    if ((execution.to_symbol ?? "").trim().toUpperCase() !== row.symbol.trim().toUpperCase()) {
      continue;
    }

    const url = explorerUrlFromExecution(execution);
    if (!url) {
      continue;
    }

    const executionMs = execution.timestamp ? Date.parse(execution.timestamp) : Number.NaN;
    const distance =
      Number.isFinite(openedAtMs) && Number.isFinite(executionMs)
        ? Math.abs(executionMs - openedAtMs)
        : Number.POSITIVE_INFINITY;

    if (!best || distance < best.distance) {
      best = { url, distance };
    }
  }

  if (best && (best.distance <= POSITION_EXECUTION_MATCH_WINDOW_MS || !Number.isFinite(openedAtMs))) {
    return best.url;
  }

  if (walletAddress) {
    return `https://bscscan.com/address/${walletAddress}#tokentxns`;
  }

  return best?.url ?? null;
}

function positivePrice(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function activePositionPnlPercent(positionRows: PositionRow[]): number | null {
  let totalEntry = 0;
  let totalCurrent = 0;
  let valid = false;

  for (const row of positionRows) {
    if (
      typeof row.entryValueUsd === "number" &&
      Number.isFinite(row.entryValueUsd) &&
      row.entryValueUsd > 0 &&
      typeof row.amount === "number" &&
      Number.isFinite(row.amount) &&
      typeof row.currentPrice === "number" &&
      Number.isFinite(row.currentPrice)
    ) {
      totalEntry += row.entryValueUsd;
      totalCurrent += row.amount * row.currentPrice;
      valid = true;
    }
  }

  if (!valid || totalEntry === 0) return null;
  return ((totalCurrent - totalEntry) / totalEntry) * 100;
}

function positionRiskStats(row: PositionRow) {
  const entry = row.entryPrice;
  const stop = row.trailingStopPrice;
  const target = row.takeProfitPrice;

  return {
    stopDistancePct:
      positivePrice(entry) && positivePrice(stop) ? ((entry - stop) / entry) * 100 : null,
    targetUpsidePct:
      positivePrice(entry) && positivePrice(target) ? ((target - entry) / entry) * 100 : null,
  };
}

function createFrozenValueStore<T>() {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next: T | null) {
      if (next !== null && next !== value) {
        value = next;
        listeners.forEach((l) => l());
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => value,
    getServerSnapshot: () => null as T | null,
  };
}

function createClockStore(intervalMs: number) {
  let value: Date | null = null;
  let intervalId: number | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        value = new Date();
        intervalId = window.setInterval(() => {
          value = new Date();
          listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
      };
    },
    getSnapshot: () => value,
    getServerSnapshot: () => null,
  };
}

type DashboardViewModel = {
  metrics: MetricView[];
  activityRows: ActivityRow[];
  logRows: ActivityRow[];
  positionRows: PositionRow[];
  totalPositionValue: string;
  walletBalances: WalletBalanceRow[];
  x402Records: X402Call[];
  x402MarketData: MarketDataRow[];
  x402MarketDataErrors: string[];
  x402Instrumented: boolean;
  x402PaidCallCount: number | null;
  x402DailySpendUsdc: number | null;
  x402TotalSpendUsdc: number | null;
  x402DailyBudgetUsdc: number | null;
  x402TotalBudgetUsdc: number | null;
  agentMode: string;
  telemetryError: string | null;
  chartData: PortfolioChartPoint[];
  mobileChartData: PortfolioChartPoint[];
  totalBalance: string;
  pnlValue: string;
  pnlDelta?: string;
  pnlTone: "positive" | "negative";
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  signDisplay: "always",
});

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function AsciiRaccoonWatermark({ glitch = false }: { glitch?: boolean }) {
  const layout =
    "pointer-events-none absolute left-1/2 top-1/2 z-0 h-[min(240px,28vh)] w-[min(240px,44vw)] bg-contain bg-center bg-no-repeat mix-blend-screen lg:left-[54%] lg:h-[min(280px,36vh)] lg:w-[min(280px,48vw)]";

  if (glitch) {
    return (
      <div
        aria-hidden
        className={cx(layout, "ascii-watermark-glitch bg-[url(/ascii-raccoon.png)]")}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cx(
        layout,
        "-translate-x-1/2 -translate-y-1/2 scale-[1.6] opacity-25 lg:scale-[2.35] lg:opacity-20 bg-[url(/ascii-raccoon.png)]",
      )}
    />
  );
}

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function SectionTransition({
  section,
  children,
  className,
  enabled = true,
}: {
  section: DashboardSection;
  children: (section: DashboardSection) => ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const [displayedSection, setDisplayedSection] = useState(section);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const wasEnabledRef = useRef(false);
  const enterIdleTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!enabled) {
      setDisplayedSection(section);
      setPhase("idle");
      wasEnabledRef.current = false;
      return;
    }

    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      setDisplayedSection(section);
      setPhase("in");

      const enterTimeout = window.setTimeout(() => {
        setPhase("idle");
      }, 380);

      return () => window.clearTimeout(enterTimeout);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [enabled, section]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!enabled) {
      return;
    }

    if (section === displayedSection) {
      return;
    }

    setPhase("out");

    const swapTimeout = window.setTimeout(() => {
      setDisplayedSection(section);
      setPhase("in");

      enterIdleTimeoutRef.current = window.setTimeout(() => {
        setPhase("idle");
      }, 380);
    }, 180);

    return () => {
      window.clearTimeout(swapTimeout);
      if (enterIdleTimeoutRef.current !== undefined) {
        window.clearTimeout(enterIdleTimeoutRef.current);
        enterIdleTimeoutRef.current = undefined;
      }
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [section, displayedSection, enabled]);

  return (
    <div className={className}>
      <div
        key={displayedSection}
        className={cx(
          "flex min-h-0 flex-1 flex-col",
          enabled && phase === "out" && "section-fade-out",
          enabled && phase === "in" && "section-fade-in",
        )}
      >
        {children(displayedSection)}
      </div>
    </div>
  );
}

function formatUsd(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? usdFormatter.format(value) : "N/A";
}

function formatUsdc(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${compactNumberFormatter.format(value)} USDC` : "N/A";
}

function formatSignedUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  if (value === 0) {
    return usdFormatter.format(0);
  }

  return `${value >= 0 ? "+" : "-"}${usdFormatter.format(Math.abs(value))}`;
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${percentFormatter.format(value)}%` : "N/A";
}

function shortHash(value: string | null | undefined) {
  if (!value) {
    return "N/A";
  }

  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function timeReference(timestamp: string | null | undefined) {
  if (!timestamp) {
    return "N/A";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function numericPortfolioValues(decisions: StatusPayload["decisions"]) {
  return decisions
    .map((decision) => decision.portfolio_value_usdc)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function latestPortfolioValue(data: StatusPayload | null) {
  if (!data) {
    return null;
  }

  if (typeof data.wallet.portfolioTotalUsd === "number") {
    return data.wallet.portfolioTotalUsd;
  }

  if (
    (data.wallet?.errors && data.wallet.errors.length > 0) ||
    data.connection?.source === "error" ||
    data.connection?.error
  ) {
    return null;
  }

  if (typeof data.latestDecision?.portfolio_value_usdc === "number") {
    return data.latestDecision.portfolio_value_usdc;
  }

  return numericPortfolioValues(data?.decisions ?? []).at(-1) ?? null;
}

function hasLiveWalletTotal(data: StatusPayload | null): data is StatusPayload & { wallet: { portfolioTotalUsd: number } } {
  return typeof data?.wallet.portfolioTotalUsd === "number" && Number.isFinite(data.wallet.portfolioTotalUsd);
}

function decisionsForPortfolioWindow(data: StatusPayload | null, range: TimeRange) {
  const ranged = decisionsForRange(data, range);

  if (!hasLiveWalletTotal(data)) {
    return ranged;
  }

  // Live TWAK total is authoritative — paper-mode portfolio snapshots skew window metrics.
  return ranged.filter((decision) => decision.mode?.toLowerCase() === "live");
}

function logWindowPnlDebug(
  data: StatusPayload | null,
  range: TimeRange,
  input: {
    rangedCount: number;
    windowDecisions: StatusPayload["decisions"];
    values: number[];
    liveTotal: number | null;
    start: number | null;
    end: number | null;
    absolute: number | null;
    percent: number | null;
  },
) {
  const cutoff = new Date(Date.now() - timeRangeDurationMs(range)).toISOString();
  const decisionRow = (decision: StatusPayload["decisions"][number], used: boolean) => ({
    used,
    cycle: decision.cycle_number ?? null,
    timestamp: decision.timestamp,
    mode: decision.mode ?? null,
    action: decision.action ?? null,
    portfolio_value_usdc: decision.portfolio_value_usdc ?? null,
  });

  const windowIds = new Set(input.windowDecisions.map((decision) => decision.timestamp));

  console.groupCollapsed(
    `[window-pnl] ${range} → ${input.absolute === null ? "N/A" : formatSignedUsd(input.absolute)} (${input.percent === null ? "N/A" : formatPercent(input.percent)})`,
  );
  console.log("window", { range, cutoff, rangedDecisionCount: input.rangedCount, liveDecisionCount: input.windowDecisions.length });
  console.log("inputs", {
    liveWalletTotalUsd: input.liveTotal,
    latestDecisionPortfolioUsd: data?.latestDecision?.portfolio_value_usdc ?? null,
    latestDecisionMode: data?.latestDecision?.mode ?? null,
    latestDecisionCycle: data?.latestDecision?.cycle_number ?? null,
    walletRefreshedAt: data?.wallet.refreshedAt ?? null,
  });
  console.log("calculation", {
    startSource: input.start !== null ? "first live decision portfolio_value_usdc in window" : null,
    endSource:
      input.liveTotal !== null
        ? "wallet.portfolioTotalUsd (live TWAK)"
        : input.end !== null
          ? "last decision portfolio_value_usdc in window"
          : null,
    startUsd: input.start,
    endUsd: input.end,
    absoluteUsd: input.absolute,
    percent: input.percent,
    portfolioValuesInWindow: input.values,
  });
  console.table(
    (data?.decisions ?? []).map((decision) =>
      decisionRow(decision, windowIds.has(decision.timestamp)),
    ),
  );
  console.groupEnd();
}

function windowPnl(data: StatusPayload | null, range: TimeRange) {
  const ranged = decisionsForRange(data, range);
  const windowDecisions = decisionsForPortfolioWindow(data, range);
  const values = numericPortfolioValues(windowDecisions);
  const liveTotal = hasLiveWalletTotal(data) ? data.wallet.portfolioTotalUsd : null;
  const start = values[0] ?? null;
  const end = liveTotal ?? values.at(-1) ?? null;

  if (start === null || end === null) {
    logWindowPnlDebug(data, range, {
      rangedCount: ranged.length,
      windowDecisions,
      values,
      liveTotal,
      start,
      end,
      absolute: null,
      percent: null,
    });
    return { absolute: null, percent: null };
  }

  if (liveTotal === null && values.length < 2) {
    logWindowPnlDebug(data, range, {
      rangedCount: ranged.length,
      windowDecisions,
      values,
      liveTotal,
      start,
      end,
      absolute: null,
      percent: null,
    });
    return { absolute: null, percent: null };
  }

  const absolute = end - start;
  const percent = start !== 0 ? (absolute / start) * 100 : null;

  logWindowPnlDebug(data, range, {
    rangedCount: ranged.length,
    windowDecisions,
    values,
    liveTotal,
    start,
    end,
    absolute,
    percent,
  });

  return { absolute, percent };
}

function chartPoints(data: StatusPayload | null, range: TimeRange): PortfolioChartPoint[] {
  const decisions = decisionsForPortfolioWindow(data, range);
  const nowIso = new Date().toISOString();
  const points: PortfolioChartPoint[] = decisions
    .filter((decision) => typeof decision.portfolio_value_usdc === "number")
    .map((decision, index) => ({
      label: decision.cycle_number ? `#${decision.cycle_number}` : `${index + 1}`,
      value: decision.portfolio_value_usdc ?? 0,
      timestamp: decision.timestamp ?? null,
    }));

  const liveTotal = hasLiveWalletTotal(data) ? data.wallet.portfolioTotalUsd : null;

  if (liveTotal !== null) {
    if (points.length === 0) {
      return [
        { label: "1", value: liveTotal, timestamp: nowIso },
        { label: "2", value: liveTotal, timestamp: nowIso },
      ];
    }

    const lastPoint = points.at(-1);
    if (lastPoint && Math.abs(lastPoint.value - liveTotal) > 0.005) {
      points.push({ label: "Live", value: liveTotal, timestamp: nowIso });
    }

    return points;
  }

  if (points.length > 0) {
    return points;
  }

  const fallback = latestPortfolioValue(data) ?? 0;
  return [
    { label: "1", value: fallback, timestamp: nowIso },
    { label: "2", value: fallback, timestamp: nowIso },
  ];
}

function executionSucceeded(execution: StatusPayload["executions"][number]) {
  const status = String(execution.result?.status ?? execution.result?.mode ?? "").toLowerCase();
  return Boolean(execution.tx_hash || execution.result?.tx_hash || execution.result?.hash || status.includes("success"));
}

function executionFailed(execution: StatusPayload["executions"][number]) {
  return Boolean(execution.error || String(execution.result?.error ?? "").trim());
}

function executionSuccessRate(executions: StatusPayload["executions"]) {
  const resolved = executions.filter((execution) => executionSucceeded(execution) || executionFailed(execution));
  if (resolved.length === 0) {
    return null;
  }

  return (resolved.filter(executionSucceeded).length / resolved.length) * 100;
}

function amountLabel(row: StatusPayload["wallet"]["movements"][number]) {
  const from = row.fromSymbol ?? "";
  const to = row.toSymbol ?? "";
  const pair = from && to ? `${from}->${to}` : row.action;
  const amount = typeof row.amountIn === "number" ? compactNumberFormatter.format(row.amountIn) : null;

  return amount ? `${amount} ${pair}` : pair.toUpperCase();
}

function activityTokenLabel(from: string | null | undefined, to: string | null | undefined): string | null {
  const normalizedTo = to?.trim();
  const normalizedFrom = from?.trim();

  if (normalizedTo) {
    const toSymbol = normalizedTo.toUpperCase();
    if (!isQuoteAsset(toSymbol) || !normalizedFrom) {
      return toSymbol;
    }
  }

  if (normalizedFrom) {
    return normalizedFrom.toUpperCase();
  }

  return normalizedTo ? normalizedTo.toUpperCase() : null;
}

const TX_HASH_VALUE_RE = /^0x[a-fA-F0-9]{64}$/;

function findTxHashInValue(value: unknown, depth = 0): string | null {
  if (depth > 3 || value == null) {
    return null;
  }

  if (typeof value === "string" && TX_HASH_VALUE_RE.test(value.trim())) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTxHashInValue(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findTxHashInValue(nested, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function movementTxHash(movement: StatusPayload["wallet"]["movements"][number]): string | null {
  return (
    movementStringField(movement, ["txHash", "tx_hash", "hash", "transactionHash", "tx"]) ??
    findTxHashInValue(movement)
  );
}

function chainFallbackToken(movement: StatusPayload["wallet"]["movements"][number]): string | null {
  const chain = movement.chain?.toLowerCase();
  if (chain === "bsc") {
    return "BNB";
  }

  if (chain === "base") {
    return "ETH";
  }

  return null;
}

function executionTxHash(execution: StatusPayload["executions"][number]): string | null {
  return (
    execution.tx_hash ??
    stringFromUnknown(execution.result?.tx_hash) ??
    stringFromUnknown(execution.result?.hash) ??
    null
  );
}

function symbolFromMovementRecord(movement: StatusPayload["wallet"]["movements"][number]): string | null {
  const record = movement as Record<string, unknown>;

  for (const key of ["toSymbol", "to_symbol", "to", "symbol", "token", "asset", "currency"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toUpperCase();
    }
  }

  const raw = record.raw;
  if (raw && typeof raw === "object") {
    for (const key of ["toSymbol", "to_symbol", "to", "symbol", "token", "asset", "currency"]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim().toUpperCase();
      }
    }
  }

  return null;
}

function movementStringField(
  movement: StatusPayload["wallet"]["movements"][number],
  keys: string[],
): string | null {
  const record = movement as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function parseSymbolFromAmount(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  const parts = value.trim().split(/\s+/);
  const candidate = parts.at(-1);
  return candidate && /[a-z]/i.test(candidate) ? candidate.toUpperCase() : null;
}

function tokenFromAmountLabel(amount: string): string | null {
  const pairMatch = amount.match(/\s([A-Za-z][A-Za-z0-9]{1,11})[-–>→]+([A-Za-z][A-Za-z0-9]{1,11})$/i);
  return pairMatch ? pairMatch[2].toUpperCase() : null;
}

function executionTokenByTxHash(data: StatusPayload | null): Map<string, string> {
  const tokens = new Map<string, string>();

  for (const execution of data?.executions ?? []) {
    const txHash = executionTxHash(execution);
    const token = activityTokenLabel(execution.from_symbol, execution.to_symbol);

    if (txHash && token) {
      const normalized = txHash.toLowerCase();
      tokens.set(normalized, token);

      if (normalized.length > 10) {
        tokens.set(normalized.slice(0, 10), token);
      }
    }
  }

  return tokens;
}

function executionTokenByTimestamp(data: StatusPayload | null): Map<string, string> {
  const tokens = new Map<string, string>();

  for (const execution of data?.executions ?? []) {
    const token = activityTokenLabel(execution.from_symbol, execution.to_symbol);
    if (execution.timestamp && token) {
      tokens.set(execution.timestamp, token);
    }
  }

  return tokens;
}

function tokenFromExecutionMatch(
  movement: StatusPayload["wallet"]["movements"][number],
  data: StatusPayload | null,
  executionTokens: Map<string, string>,
  executionTimestampTokens: Map<string, string>,
): string | null {
  const txHash = movementTxHash(movement)?.toLowerCase();

  if (txHash) {
    const direct =
      executionTokens.get(txHash) ??
      executionTokens.get(txHash.slice(0, 10)) ??
      executionTokens.get(txHash.slice(0, 6));

    if (direct) {
      return direct;
    }

    for (const execution of data?.executions ?? []) {
      const executionHash = executionTxHash(execution)?.toLowerCase();
      if (
        executionHash &&
        (executionHash === txHash ||
          executionHash.startsWith(txHash) ||
          txHash.startsWith(executionHash) ||
          executionHash.slice(0, 10) === txHash.slice(0, 10))
      ) {
        const token = activityTokenLabel(execution.from_symbol, execution.to_symbol);
        if (token) {
          return token;
        }
      }
    }
  }

  const timestamp = movement.timestamp;
  if (timestamp) {
    const exact = executionTimestampTokens.get(timestamp);
    if (exact) {
      return exact;
    }

    const movementTime = Date.parse(timestamp);
    if (Number.isFinite(movementTime)) {
      for (const execution of data?.executions ?? []) {
        if (!execution.timestamp) {
          continue;
        }

        const executionTime = Date.parse(execution.timestamp);
        if (!Number.isFinite(executionTime) || Math.abs(executionTime - movementTime) > 120_000) {
          continue;
        }

        const token = activityTokenLabel(execution.from_symbol, execution.to_symbol);
        if (token) {
          return token;
        }
      }
    }
  }

  return null;
}

function activityTokenFromMovement(
  movement: StatusPayload["wallet"]["movements"][number],
  data: StatusPayload | null,
  executionTokens: Map<string, string>,
  executionTimestampTokens: Map<string, string>,
): string | null {
  const fromSymbol = movementStringField(movement, ["fromSymbol", "from_symbol"]);
  const toSymbol = movementStringField(movement, ["toSymbol", "to_symbol"]);
  const fromSymbols = activityTokenLabel(fromSymbol, toSymbol);
  if (fromSymbols) {
    return fromSymbols;
  }

  const fromRecord = symbolFromMovementRecord(movement);
  if (fromRecord) {
    return fromRecord;
  }

  const input = movementStringField(movement, ["input", "Input"]);
  const fromInput = parseSymbolFromAmount(input);
  if (fromInput) {
    return fromInput;
  }

  const output = movementStringField(movement, ["output", "Output"]) ?? movement.output;
  const fromOutput = parseSymbolFromAmount(output);
  if (fromOutput) {
    return fromOutput;
  }

  const fromExecution = tokenFromExecutionMatch(movement, data, executionTokens, executionTimestampTokens);
  if (fromExecution) {
    return fromExecution;
  }

  const fromAmount = tokenFromAmountLabel(amountLabel(movement));
  if (fromAmount) {
    return fromAmount;
  }

  const pairMatch = movement.action?.match(/([A-Za-z][A-Za-z0-9]{1,11})\s*[-–>→]+\s*([A-Za-z][A-Za-z0-9]{1,11})/i);
  if (pairMatch) {
    return pairMatch[2].toUpperCase();
  }

  return chainFallbackToken(movement);
}

function decisionAnalysisNarrative(decision: StatusPayload["decisions"][number]): string {
  const symbol = decision.symbol?.trim() || "candidate";
  const action = String(decision.action ?? "WAIT").toUpperCase();
  const strategyMode = resolveStrategyMode(decision);
  const priced =
    decision.priced_target_count != null
      ? ` across ${decision.priced_target_count} priced targets`
      : "";

  if (isComplianceDecision(decision)) {
    const target = decision.symbol?.trim() ? ` into ${decision.symbol.trim()}` : "";
    return `Daily-minimum compliance swap${target}: a tiny trade to satisfy the one-trade-per-day rule. Not scored against the entry factors.`;
  }

  if (strategyMode === "scalping") {
    const stats = scalpingFactorStats(decision);
    const result = stats.met ? "cleared the entry bar" : "stayed below the entry bar";

    return `Analyzed ${symbol}${priced}: checked micro-momentum, slippage, regime, whale flow, and gas, then scored ${stats.score}/${stats.max}; ${result} before ${action}.`;
  }

  const breakoutScore = breakoutEntryScoreStats(decision);
  if (breakoutScore.score != null) {
    const result =
      breakoutScore.met
        ? "cleared score and slippage"
        : breakoutScore.scoreMet
          ? "met score but not the slippage gate"
          : "stayed below the entry bar";

    return `Analyzed ${symbol}${priced}: refreshed market data, scored ${breakoutScore.score}/${breakoutScore.max}, and checked TWAK slippage; ${result} before ${action}.`;
  }

  const stats = entryFactorStats(decision);
  const result = stats.met ? "all gates aligned" : "not enough gates aligned";

  return `Analyzed ${symbol}${priced}: refreshed market data, tested breakout, regime, RSI, slippage, and derivatives risk, then logged ${stats.passed}/${stats.total} factors; ${result} before ${action}.`;
}

function decisionActivityRowId(
  decision: StatusPayload["decisions"][number],
  index: number,
  scope: "recent" | "log",
) {
  return [
    "decision",
    scope,
    decision.timestamp ?? "no-time",
    decision.cycle_number ?? "no-cycle",
    decision.symbol?.trim() || "no-symbol",
    decision.action || "no-action",
    index,
  ].join("-");
}

function activityFromTelemetry(data: StatusPayload | null): ActivityRow[] {
  const executionTokens = executionTokenByTxHash(data);
  const executionTimestampTokens = executionTokenByTimestamp(data);

  const sellHistoryRows =
    data?.sellHistory?.slice(0, 7).map((row, index) => {
      const txHash = row.exit_tx_hash ?? null;

      return {
        id: `sell-${txHash ?? index}`,
        amount: `${compactNumberFormatter.format(row.amount_sold)} ${row.symbol} sold`,
        timestamp: row.timestamp ?? null,
        token: row.symbol,
        hash: shortHash(txHash),
        explorerUrl: explorerUrlFor("bsc", txHash),
        status: row.verified ? "VERIFIED" : "UNVERIFIED",
        tone: row.verified ? "green" : "red",
        details: detailsFromSellHistory(row),
      } satisfies ActivityRow;
    }) ?? [];

  if (sellHistoryRows.length > 0) {
    return sellHistoryRows;
  }

  const movements =
    data?.wallet.movements.slice(0, 7).map((movement, index) => {
      const failed = Boolean(movement.error) || String(movement.status ?? "").toLowerCase().includes("failed");
      const txHash = movementTxHash(movement);
      const pending = !txHash && !failed;

      return {
        id: `movement-${txHash ?? movement.timestamp ?? index}`,
        amount: amountLabel(movement),
        timestamp: movement.timestamp ?? null,
        token: activityTokenFromMovement(movement, data, executionTokens, executionTimestampTokens),
        hash: shortHash(txHash),
        explorerUrl: movement.explorerUrl ?? explorerUrlFor(movement.chain, txHash),
        status: failed ? "FAILED" : pending ? "PENDING" : "SUCCESS",
        tone: failed ? "red" : pending ? "yellow" : "green",
        details: detailsFromMovement(movement),
      } satisfies ActivityRow;
    }) ?? [];

  if (movements.length > 0) {
    return movements;
  }

  const executions =
    data?.executions.slice(0, 7).map((execution, index) => {
      const failed = executionFailed(execution);
      const pending = !executionSucceeded(execution) && !failed;
      const from = execution.from_symbol ?? "";
      const to = execution.to_symbol ?? "";

      const txHash =
        execution.tx_hash ?? stringFromUnknown(execution.result?.tx_hash) ?? stringFromUnknown(execution.result?.hash);

      return {
        id: `execution-${execution.timestamp ?? index}-${txHash ?? index}`,
        amount:
          typeof execution.amount_in === "number"
            ? `${compactNumberFormatter.format(execution.amount_in)} ${from}->${to}`
            : `${from}->${to}`,
        timestamp: execution.timestamp ?? null,
        token: activityTokenLabel(from, to),
        hash: shortHash(txHash),
        explorerUrl: explorerUrlFromExecution(execution),
        status: failed ? "FAILED" : pending ? "PENDING" : "SUCCESS",
        tone: failed ? "red" : pending ? "yellow" : "green",
        details: detailsFromExecution(execution),
      } satisfies ActivityRow;
    }) ?? [];

  if (executions.length > 0) {
    return executions;
  }

  const decisions =
    data?.decisions
      .slice(-7)
      .reverse()
      .map((decision, index) => {
        const action = decision.action;

        return {
          id: decisionActivityRowId(decision, index, "recent"),
          amount: formatDecisionEvent(decision),
          narrative: decisionAnalysisNarrative(decision),
          timestamp: decision.timestamp ?? null,
          token: decision.symbol?.trim() || null,
          hash: decision.cycle_number ? `cycle #${decision.cycle_number}` : timeReference(decision.timestamp),
          explorerUrl: null,
          status: action,
          tone: action === "HALT" ? "red" : action === "ENTER" ? "green" : "yellow",
          details: detailsFromDecision(decision),
        } satisfies ActivityRow;
      }) ?? [];

  if (decisions.length > 0) {
    return decisions;
  }

  const agentLog = resolveAgentLogLine(data);
  if (agentLog.line) {
    return [
      {
        id: "agent-log-latest",
        amount: agentLog.line,
        timestamp: data?.health.lastLogModifiedAt ?? null,
        token: null,
        hash: agentLog.source ?? "agent.log",
        explorerUrl: null,
        status: data?.health.agentRunning ? "RUNNING" : "OFFLINE",
        tone: data?.health.agentRunning ? "green" : "red",
      },
    ];
  }

  const fileRows = [
    { label: "agent.log", file: data?.files.agentLog },
    { label: "decision_log.jsonl", file: data?.files.decisionLog },
    { label: "execution_log.jsonl", file: data?.files.executionLog },
  ].flatMap(({ label, file }, index) => {
    if (!file) {
      return [];
    }

    return [
      {
        id: `file-${label}-${index}`,
        amount: file.exists ? `${label} detected, waiting for records` : `${label} not found`,
        timestamp: file.modifiedAt ?? null,
        token: null,
        hash: file.modifiedAt ? timeReference(file.modifiedAt) : "file check",
        explorerUrl: null,
        status: file.exists ? "READY" : "MISSING",
        tone: file.exists ? "yellow" : "red",
      } satisfies ActivityRow,
    ];
  });

  if (fileRows.length > 0) {
    return fileRows;
  }

  return [];
}

function logRowsFromTelemetry(data: StatusPayload | null): ActivityRow[] {
  const decisionRows =
    data?.decisions
      .slice()
      .reverse()
      .map((decision, index) => {
        const action = decision.action;

        return {
          id: decisionActivityRowId(decision, index, "log"),
          amount: formatDecisionEvent(decision),
          narrative: decisionAnalysisNarrative(decision),
          timestamp: decision.timestamp ?? null,
          token: decision.symbol?.trim() || null,
          hash: decision.cycle_number ? `cycle #${decision.cycle_number}` : timeReference(decision.timestamp),
          explorerUrl: null,
          status: action,
          tone: action === "HALT" ? "red" : action === "ENTER" ? "green" : "yellow",
          details: detailsFromDecision(decision),
        } satisfies ActivityRow;
      }) ?? [];

  if (decisionRows.length > 0) {
    return decisionRows;
  }

  const executionRows =
    data?.executions
      .slice()
      .reverse()
      .map((execution, index) => {
        const failed = executionFailed(execution);
        const pending = !executionSucceeded(execution) && !failed;
        const from = execution.from_symbol ?? "";
        const to = execution.to_symbol ?? "";
        const txHash =
          execution.tx_hash ?? stringFromUnknown(execution.result?.tx_hash) ?? stringFromUnknown(execution.result?.hash);

        return {
          id: `execution-${execution.timestamp ?? index}-${txHash ?? index}`,
          amount:
            typeof execution.amount_in === "number"
              ? `${compactNumberFormatter.format(execution.amount_in)} ${from}->${to}`
              : `${from}->${to}`,
          timestamp: execution.timestamp ?? null,
          token: activityTokenLabel(from, to),
          hash: shortHash(txHash),
          explorerUrl: explorerUrlFromExecution(execution),
          status: failed ? "FAILED" : pending ? "PENDING" : "SUCCESS",
          tone: failed ? "red" : pending ? "yellow" : "green",
          details: detailsFromExecution(execution),
        } satisfies ActivityRow;
      }) ?? [];

  if (executionRows.length > 0) {
    return executionRows;
  }

  const agentLog = resolveAgentLogLine(data);
  if (agentLog.line) {
    return [
      {
        id: "agent-log-latest",
        amount: agentLog.line,
        timestamp: data?.health.lastLogModifiedAt ?? null,
        token: null,
        hash: agentLog.source ?? "agent.log",
        explorerUrl: null,
        status: data?.health.agentRunning ? "RUNNING" : "OFFLINE",
        tone: data?.health.agentRunning ? "green" : "red",
      },
    ];
  }

  const fileRows = [
    { label: "agent.log", file: data?.files.agentLog },
    { label: "decision_log.jsonl", file: data?.files.decisionLog },
    { label: "execution_log.jsonl", file: data?.files.executionLog },
  ].flatMap(({ label, file }, index) => {
    if (!file) {
      return [];
    }

    return [
      {
        id: `file-${label}-${index}`,
        amount: file.exists ? `${label} on EC2, waiting for records` : `${label} not found on EC2`,
        timestamp: file.modifiedAt ?? null,
        token: null,
        hash: file.modifiedAt ? timeReference(file.modifiedAt) : "file check",
        explorerUrl: null,
        status: file.exists ? "READY" : "MISSING",
        tone: file.exists ? "yellow" : "red",
      } satisfies ActivityRow,
    ];
  });

  return fileRows;
}

function livePriceFor(amount: number | null, valueUsd: number | null): number | null {
  if (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount > 0 &&
    typeof valueUsd === "number" &&
    Number.isFinite(valueUsd) &&
    valueUsd > 0
  ) {
    return valueUsd / amount;
  }
  return null;
}

function activePositionRowsFromTelemetry(data: StatusPayload | null): PositionRow[] {
  const holdings = boughtTokensFromTelemetry(data);

  // Derive a live current price per token from wallet balances (USD value / token amount).
  const livePriceByKey = new Map<string, number>();
  for (const holding of holdings) {
    const price = livePriceFor(holding.amount, holding.valueUsd);
    if (price !== null) {
      livePriceByKey.set(competitionTokenKey(holding.symbol), price);
    }
  }

  const trackedRows = (data?.positions.positions ?? [])
    .filter((position) => {
      const amount = position.amount_tokens;
      return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
    })
    .map((position, index) => ({
      id: `position-${position.symbol}-${position.opened_at ?? index}`,
      symbol: position.symbol,
      source: "tracked" as const,
      amount: position.amount_tokens ?? null,
      entryPrice: position.entry_price ?? null,
      entryValueUsd: position.entry_value_usdc ?? null,
      currentPrice:
        position.current_price ?? livePriceByKey.get(competitionTokenKey(position.symbol)) ?? null,
      highestPrice: position.highest_price ?? null,
      trailingStopPrice: position.trailing_stop_price ?? null,
      takeProfitPrice: position.take_profit_price ?? null,
      openedAt: position.opened_at ?? null,
    }));

  const trackedSymbols = new Set(trackedRows.map((row) => competitionTokenKey(row.symbol)));
  const walletRows = holdings
    .filter((holding) => holding.status === "HELD" && !trackedSymbols.has(competitionTokenKey(holding.symbol)))
    .map((holding) => ({
      id: `wallet-position-${holding.chain}-${holding.symbol}`,
      symbol: holding.symbol,
      source: "wallet" as const,
      amount: holding.amount,
      entryPrice: null,
      entryValueUsd: holding.valueUsd ?? holding.entryValueUsd,
      currentPrice: livePriceFor(holding.amount, holding.valueUsd ?? holding.entryValueUsd),
      highestPrice: null,
      trailingStopPrice: null,
      takeProfitPrice: null,
      openedAt: null,
    }));

  return [...trackedRows, ...walletRows];
}

function buildViewModel(
  data: StatusPayload | null,
  error: string | null,
  timeRange: TimeRange,
): DashboardViewModel {
  const latest = latestPortfolioValue(data);
  const pnl = windowPnl(data, timeRange);
  const pnlTone = (pnl.absolute ?? 0) >= 0 ? "positive" : "negative";
  const activeTrades = realActiveTradeCount(data);
  const successRate = executionSuccessRate(data?.executions ?? []);
  const chart = chartPoints(data, timeRange);
  const windowDelta =
    pnl.absolute !== null && pnl.absolute !== 0 ? formatPercent(pnl.percent) : undefined;
  const positionRows = activePositionRowsFromTelemetry(data);
  const totalPositionValue = positionRows.reduce((sum, row) => sum + (row.entryValueUsd ?? 0), 0);
  const latestX402 =
    (data?.x402?.records ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0] ?? null;

  return {
    metrics: [
      {
        label: "Total Balance",
        value: formatUsd(latest),
        unit: typeof latest === "number" ? "USD" : undefined,
        tooltip: "Live TWAK portfolio total when available; otherwise latest strategy portfolio value.",
      },
      {
        label: "Window Profit/Loss",
        value: formatSignedUsd(pnl.absolute),
        delta: windowDelta,
        tone: pnlTone,
        tooltip:
          "Change from the first live decision in the selected window to the current TWAK portfolio total. Paper-mode snapshots are excluded when live wallet data is available.",
      },
      {
        label: "Active Trades",
        value: String(activeTrades ?? 0),
        tooltip: "On-chain or positions.json holdings only. Paper-mode signals are excluded.",
      },
      {
        label: "Execution Rate",
        value: successRate === null ? "N/A" : `${successRate.toFixed(1)}%`,
        tooltip: "Successful execution records over resolved execution attempts.",
      },
    ],
    activityRows: activityFromTelemetry(data),
    logRows: logRowsFromTelemetry(data),
    positionRows,
    totalPositionValue: formatUsd(totalPositionValue),
    walletBalances: liveWalletBalancesFromTelemetry(data),
    x402Records: data?.x402?.records ?? [],
    x402MarketData: data?.x402?.marketData ?? [],
    x402MarketDataErrors: data?.x402?.marketDataErrors ?? [],
    x402Instrumented: data?.x402?.instrumented ?? false,
    x402PaidCallCount: data?.x402?.paidCallCount ?? null,
    x402DailySpendUsdc: data?.x402?.dailySpendUsdc ?? latestX402?.daily_spend_usdc ?? null,
    x402TotalSpendUsdc: data?.x402?.totalSpendUsdc ?? latestX402?.total_spend_usdc ?? null,
    x402DailyBudgetUsdc: data?.x402?.dailyBudgetUsdc ?? null,
    x402TotalBudgetUsdc: data?.x402?.totalBudgetUsdc ?? null,
    agentMode: agentModeLabel(data),
    telemetryError: error ?? data?.connection?.error ?? null,
    chartData: chart,
    mobileChartData: chart.slice(-16).length > 1 ? chart.slice(-16) : chart,
    totalBalance: formatUsd(latest),
    pnlValue: formatSignedUsd(pnl.absolute),
    pnlDelta: windowDelta,
    pnlTone,
  };
}

function DesktopNavRail({
  activeSection,
  onNavigate,
}: {
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
}) {
  return (
    <nav
      className="relative z-[1] flex h-dvh shrink-0 flex-col items-center border-r border-[#1A1A1A] bg-[#050505]/95 backdrop-blur-sm"
      style={{ width: DESKTOP_NAV_WIDTH }}
      aria-label="Dashboard navigation"
    >
      <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-[#111111]">
        <BrandMark variant="rail" />
      </div>
      <div className="flex w-full flex-1 flex-col items-center gap-1 px-2 py-3">
        {desktopNavItems.map((item) => {
          const Icon = item.icon;
          const active = item.kind === "section" && item.section === activeSection;
          const rowClassName = cx(
            "relative flex h-10 w-10 items-center justify-center rounded-sm transition-colors",
            active ? "text-white" : "text-[#7A7A7A] hover:text-white",
          );
          const rowContent = (
            <>
              {active ? (
                <span
                  className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-white"
                  aria-hidden="true"
                />
              ) : null}
              <Icon size={19} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
            </>
          );

          if (item.kind === "link") {
            return (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                aria-label={item.ariaLabel}
                title={item.label}
                className={rowClassName}
              >
                {rowContent}
              </a>
            );
          }

          return (
            <button
              key={item.section}
              type="button"
              onClick={() => onNavigate(item.section)}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
              className={rowClassName}
            >
              {rowContent}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function StatusBadge({ status, tone }: { status: string; tone: "green" | "yellow" | "red" }) {
  const classes = {
    green: "border-[#00FF66] bg-[#001A0A] text-[#00FF66]",
    yellow: "border-[#FFD21A] bg-[#1B1600] text-[#FFD21A]",
    red: "border-[#FF3737] bg-[#1B0505] text-[#FF3737]",
  }[tone];

  return <span className={cx("inline-flex border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.08em]", classes)}>[{status}]</span>;
}

function statusToneTextClass(tone: "green" | "yellow" | "red") {
  return {
    green: "text-[#00FF66]",
    yellow: "text-[#FFD21A]",
    red: "text-[#FF3737]",
  }[tone];
}

function StatusDot({ status, tone }: { status: string; tone: "green" | "yellow" | "red" }) {
  const color = {
    green: "bg-[#00FF66] shadow-[0_0_6px_rgba(0,255,102,0.45)]",
    yellow: "bg-[#FFD21A] shadow-[0_0_6px_rgba(255,210,26,0.35)]",
    red: "bg-[#FF3737] shadow-[0_0_6px_rgba(255,55,55,0.35)]",
  }[tone];

  return (
    <span
      className={cx("inline-block h-2 w-2 shrink-0 rounded-full", color)}
      title={status}
      aria-label={status}
    />
  );
}

function activityStatusGlyph(status: string): string | null {
  switch (status.toUpperCase()) {
    case "ENTER":
      return "▲";
    case "WAIT":
      return "○";
    case "HALT":
      return "■";
    case "SUCCESS":
      return "✓";
    case "PENDING":
      return "◐";
    case "FAILED":
    case "MISSING":
    case "OFFLINE":
      return "×";
    case "RUNNING":
    case "READY":
      return "●";
    default:
      return null;
  }
}

function ActivityStatusIndicator({
  status,
  tone,
  compact = false,
  readable = false,
}: {
  status: string;
  tone: "green" | "yellow" | "red";
  compact?: boolean;
  readable?: boolean;
}) {
  const glyph = activityStatusGlyph(status);

  if (glyph) {
    return (
      <span
        className={cx(
          "inline-flex shrink-0 items-center justify-center font-mono font-bold leading-none",
          compact ? (readable ? "text-[15px]" : "text-[13px]") : "text-[15px]",
          statusToneTextClass(tone),
        )}
        title={status}
        aria-label={status}
      >
        {glyph}
      </span>
    );
  }

  return (
    <>
      <StatusDot status={status} tone={tone} />
      <span
        className={cx(
          "truncate font-mono font-bold uppercase tracking-[0.06em]",
          compact ? (readable ? "text-[10px]" : "text-[8px]") : "text-[10px]",
          statusToneTextClass(tone),
        )}
      >
        {status}
      </span>
    </>
  );
}

function formatTokenAmount(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  if (value >= 1_000_000) {
    return `${compactNumberFormatter.format(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return compactNumberFormatter.format(value);
  }

  if (value >= 1) {
    return compactNumberFormatter.format(value);
  }

  return value.toPrecision(4);
}

function TelemetryBanner({ message }: { message: string }) {
  return (
    <div className="border-b border-[#3A2200] bg-[#1B1200] px-5 py-3 font-mono text-[12px] leading-5 text-[#FFD21A]">
      <span className="font-bold uppercase tracking-[0.12em]">Telemetry:</span> {message}
      <span className="mt-1 block text-[#CFCFCF]">
        Local dev: set `AGENT_EXPORTER_URL` in `apps/web/.env.local` to the same EC2 HTTPS URL used on Vercel, or run the
        local exporter on port 8787.
      </span>
    </div>
  );
}

function WalletHeaderCell({
  column,
  label,
  className,
  align = "left",
}: {
  column: "chain" | "token" | "amount" | "value";
  label: string;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <th className={className}>
      <ViewportReveal
        as="span"
        variant={walletColumnVariant(column)}
        delay={walletCellDelay(0, column)}
        duration="fast"
        className={cx("block", align === "right" && "text-right")}
      >
        {label}
      </ViewportReveal>
    </th>
  );
}

function WalletBalanceTableRow({
  balance,
  index,
  compact,
  scrollRoot,
}: {
  balance: WalletBalanceRow;
  index: number;
  compact: boolean;
  scrollRoot: Element | null;
}) {
  const isLeadHolding = index === 0 && (balance.valueUsd ?? 0) > 0;
  const tokenVariant = isLeadHolding ? walletRowLeadVariant(balance.symbol, balance.valueUsd, index) : walletColumnVariant("token");

  return (
    <tr
      className={cx("border-b border-[#1A1A1A] text-white", !compact && "hover:bg-[#070707]")}
    >
      <td className="truncate px-3 py-2 font-mono text-[12px] uppercase text-[#A8A8A8]">
        <ViewportReveal
          as="span"
          variant={walletColumnVariant("chain")}
          delay={walletCellDelay(index, "chain")}
          root={scrollRoot}
          className="block truncate"
        >
          {balance.chain}
        </ViewportReveal>
      </td>
      <td className="truncate px-2 py-2 font-mono text-[13px] font-bold text-[#F2F2F2]">
        <ViewportReveal
          as="span"
          variant={tokenVariant}
          delay={walletCellDelay(index, "token")}
          duration={isLeadHolding ? "slow" : "normal"}
          root={scrollRoot}
          className="inline-flex min-w-0 items-center gap-1.5"
        >
          <TokenIcon symbol={balance.symbol} size={16} />
          <span className="truncate">{balance.symbol}</span>
        </ViewportReveal>
      </td>
      <td className="truncate px-2 py-2 font-mono text-[12px] tabular-nums text-[#D0D0D0]">
        <ViewportReveal
          as="span"
          variant={walletColumnVariant("amount")}
          delay={walletCellDelay(index, "amount")}
          root={scrollRoot}
          className="block truncate"
        >
          {formatTokenAmount(balance.amount)}
        </ViewportReveal>
      </td>
      <td className="truncate px-3 py-2 text-right font-mono text-[12px] tabular-nums text-[#D0D0D0]">
        <ViewportReveal
          as="span"
          variant={walletColumnVariant("value")}
          delay={walletCellDelay(index, "value")}
          duration={isLeadHolding ? "slow" : "normal"}
          root={scrollRoot}
          className="block truncate"
        >
          {formatUsd(balance.valueUsd)}
        </ViewportReveal>
      </td>
    </tr>
  );
}

function WalletPanel({
  balances,
  agentMode,
  compact = false,
  desktop = false,
}: {
  balances: WalletBalanceRow[];
  agentMode: string;
  compact?: boolean;
  desktop?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const paperMode = agentMode === "PAPER";
  const totalValue = balances.reduce((sum, balance) => sum + (balance.valueUsd ?? 0), 0);
  const flat = panelUsesFlatChrome(compact, desktop);
  const tableCompact = flat;

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <section
      className={cx(
        "flex min-h-0 flex-col",
        compact && "flex-1 px-4 pt-4",
        desktop && "flex-1 px-8 pt-6",
        !flat && "mx-10 my-9 border border-[#2A2A2A] bg-black/88",
      )}
    >
      <div className={cx(flat ? "shrink-0 border-b border-[#1A1A1A] pb-4" : "border-b border-[#1A1A1A] px-5 py-5")}>
        <ViewportReveal variant="blur" duration="slow">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">TWAK Wallet</div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1
              className={cx(
                "font-mono font-semibold leading-tight text-white",
                flat ? "text-[28px]" : "text-[32px]",
              )}
            >
              Live Holdings
            </h1>
            <div className="shrink-0 text-right font-mono">
              <ViewportReveal variant="fade" delay={70} duration="fast">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[#757575]">
                  {balances.length} {balances.length === 1 ? "token" : "tokens"}
                </div>
              </ViewportReveal>
              <ViewportReveal variant="scale" delay={130} duration="slow">
                <div className="mt-1 text-sm tabular-nums text-white">{formatUsd(totalValue)}</div>
              </ViewportReveal>
              {paperMode ? (
                <ViewportReveal variant="down" delay={190} duration="fast">
                  <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[#FFD21A]">Paper mode</div>
                </ViewportReveal>
              ) : null}
            </div>
          </div>
        </ViewportReveal>
      </div>

      <div
        ref={scrollRef}
        className={cx(
          "console-scroll overflow-x-auto overflow-y-auto",
          flat ? "min-h-0 flex-1" : "max-h-[min(70vh,720px)]",
        )}
      >
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[22%]" />
            <col className="w-[32%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead className="border-b border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
            <tr>
              <WalletHeaderCell column="chain" label="Chain" className="px-3 py-2" />
              <WalletHeaderCell column="token" label="Token" className="px-2 py-2" />
              <WalletHeaderCell column="amount" label="Amount" className="px-2 py-2" />
              <WalletHeaderCell column="value" label="Value" className="px-3 py-2" align="right" />
            </tr>
          </thead>
          <tbody>
            {balances.map((balance, index) => (
              <WalletBalanceTableRow
                key={`${balance.chain}-${balance.symbol}`}
                balance={balance}
                index={index}
                compact={tableCompact}
                scrollRoot={scrollRoot}
              />
            ))}
            {balances.length === 0 ? (
              <tr className="border-b border-[#1A1A1A]">
                <td className="px-3 py-4 font-mono text-[12px] text-[#8A8A8A]" colSpan={4}>
                  <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                    Waiting for TWAK wallet balances
                  </ViewportReveal>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function X402SummaryMetric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "red";
}) {
  return (
    <div className="min-w-0 text-right font-mono">
      <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[#757575]">{label}</div>
      <div className={cx("mt-1 truncate text-sm tabular-nums", tone === "red" ? "text-[#FF7373]" : "text-white")}>
        {value}
      </div>
      {sub ? <span className="font-mono text-[9px] text-[#666]">{sub}</span> : null}
    </div>
  );
}

function x402MarketSourceLabel(source: MarketDataRow["source"]) {
  switch (source) {
    case "price_and_volume":
      return "PRICE + VOLUME";
    case "price_cache":
      return "PRICE";
    case "volume_cache":
      return "VOLUME";
  }
}

function latestMarketDataAge(rows: MarketDataRow[]) {
  const latest = rows
    .map((row) => (row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];

  if (latest == null) {
    return "N/A";
  }

  const minutes = Math.max(0, Math.round((Date.now() - latest) / 60_000));
  if (minutes < 1) {
    return "<1m";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / 60)}h`;
}

function formatMarketVolume(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  if (Math.abs(value) >= 1_000_000_000) {
    return `${compactNumberFormatter.format(value / 1_000_000_000)}B`;
  }

  if (Math.abs(value) >= 1_000_000) {
    return `${compactNumberFormatter.format(value / 1_000_000)}M`;
  }

  if (Math.abs(value) >= 1_000) {
    return `${compactNumberFormatter.format(value / 1_000)}K`;
  }

  return compactNumberFormatter.format(value);
}

function marketChangeTone(value: number | null | undefined): "green" | "yellow" | "red" {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "yellow";
  }

  return value > 0 ? "green" : "red";
}

function marketToneClass(tone: "green" | "yellow" | "red") {
  if (tone === "green") {
    return "text-[#00FF66]";
  }

  if (tone === "red") {
    return "text-[#FF7373]";
  }

  return "text-[#A8A8A8]";
}

function X402MarketDataPanel({
  rows,
  errors,
  scrollRoot,
}: {
  rows: MarketDataRow[];
  errors: string[];
  scrollRoot: Element | null;
}) {
  const sortedRows = useMemo(
    () =>
      rows.slice().sort((left, right) => {
        const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
        const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
        return rightTime - leftTime || left.symbol.localeCompare(right.symbol);
      }),
    [rows],
  );
  const pricedCount = sortedRows.filter((row) => row.price != null).length;
  const volumeCount = sortedRows.filter((row) => row.volume != null).length;

  return (
    <div className="border-b border-[#1A1A1A] py-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-3">
        <ViewportReveal variant="blur" duration="slow" root={scrollRoot} className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Data gathered</div>
          <h2 className="mt-1 font-mono text-[18px] font-semibold leading-tight text-white">Market snapshot cache</h2>
        </ViewportReveal>
        <div className="grid grid-cols-3 gap-x-5 gap-y-2">
          <X402SummaryMetric label="Symbols" value={String(sortedRows.length)} />
          <X402SummaryMetric label="Prices" value={String(pricedCount)} />
          <X402SummaryMetric label="Fresh" value={latestMarketDataAge(sortedRows)} />
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="mx-3 mb-3 border border-[#3A2020] bg-[#1B0505]/55 px-3 py-2 font-mono text-[11px] leading-5 text-[#FF7373]">
          {errors.slice(0, 2).join(" · ")}
        </div>
      ) : null}

      <table className="min-w-[820px] w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[15%]" />
          <col className="w-[17%]" />
          <col className="w-[14%]" />
          <col className="w-[17%]" />
          <col className="w-[14%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="border-y border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
          <tr>
            {["Token", "Price", "Price Δ", "Volume", "Volume Δ", "Updated", "Source"].map((label) => (
              <th key={label} className="px-3 py-2">
                <ViewportReveal as="span" variant="fade" duration="fast" root={scrollRoot} className="block truncate">
                  {label}
                </ViewportReveal>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => {
            const priceTone = marketChangeTone(row.priceChangePct);
            const volumeTone = marketChangeTone(row.volumeChangePct);
            return (
              <tr key={`${row.symbol}-${row.updatedAt ?? index}`} className="border-b border-[#1A1A1A] text-white hover:bg-[#070707]">
                <td className="px-3 py-2">
                  <ViewportReveal
                    as="span"
                    variant={walletColumnVariant("token")}
                    delay={walletCellDelay(index, "token")}
                    root={scrollRoot}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <TokenIcon symbol={row.symbol} size={14} />
                    <span className="truncate font-mono text-[12px] font-bold text-[#F2F2F2]">{row.symbol}</span>
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-mono text-[12px] tabular-nums text-[#D0D0D0]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "amount")} root={scrollRoot} className="block truncate">
                    {formatPrice(row.price)}
                  </ViewportReveal>
                </td>
                <td className={cx("truncate px-3 py-2 font-mono text-[12px] tabular-nums", marketToneClass(priceTone))}>
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "value")} root={scrollRoot} className="block truncate">
                    {formatPercent(row.priceChangePct)}
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-mono text-[12px] tabular-nums text-[#D0D0D0]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "amount")} root={scrollRoot} className="block truncate">
                    {formatMarketVolume(row.volume)}
                  </ViewportReveal>
                </td>
                <td className={cx("truncate px-3 py-2 font-mono text-[12px] tabular-nums", marketToneClass(volumeTone))}>
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "value")} root={scrollRoot} className="block truncate">
                    {formatPercent(row.volumeChangePct)}
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-mono text-[12px] tabular-nums text-[#A8A8A8]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "chain")} root={scrollRoot} className="block truncate">
                    {formatOpenedAt(row.updatedAt)}
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-mono text-[10px] font-bold tracking-[0.08em] text-[#8A8A8A]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "value")} root={scrollRoot} className="block truncate">
                    {x402MarketSourceLabel(row.source)}
                  </ViewportReveal>
                </td>
              </tr>
            );
          })}
          {sortedRows.length === 0 ? (
            <tr className="border-b border-[#1A1A1A]">
              <td className="px-3 py-4 font-mono text-[12px] text-[#8A8A8A]" colSpan={7}>
                <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                  No market cache rows available yet
                </ViewportReveal>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {volumeCount === 0 && sortedRows.length > 0 ? (
        <div className="px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#666666]">
          Volume cache has not populated for the visible rows.
        </div>
      ) : null}
    </div>
  );
}

function X402PaymentsPanel({
  records,
  marketData,
  marketDataErrors,
  instrumented,
  paidCallCount,
  dailySpendUsdc,
  totalSpendUsdc,
  dailyBudgetUsdc,
  totalBudgetUsdc,
  compact = false,
  desktop = false,
}: {
  records: X402Call[];
  marketData: MarketDataRow[];
  marketDataErrors: string[];
  instrumented: boolean;
  paidCallCount: number | null;
  dailySpendUsdc: number | null;
  totalSpendUsdc: number | null;
  dailyBudgetUsdc: number | null;
  totalBudgetUsdc: number | null;
  compact?: boolean;
  desktop?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const flat = panelUsesFlatChrome(compact, desktop);
  const sortedRecords = useMemo(
    () =>
      records.slice().sort((left, right) => {
        const leftTime = Date.parse(left.ts);
        const rightTime = Date.parse(right.ts);
        const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
        const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
        return safeRight - safeLeft;
      }),
    [records],
  );
  const latestRecord = sortedRecords[0] ?? null;
  const failureCount = sortedRecords.filter((record) => record.outcome === "failure").length;
  const emptyMessage = instrumented ? "No x402 payments recorded" : "x402 logging not instrumented yet";

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <section
      className={cx(
        "flex min-h-0 flex-col",
        compact && "flex-1 px-4 pt-4",
        desktop && "flex-1 px-8 pt-6",
        !flat && "mx-10 my-9 border border-[#2A2A2A] bg-black/88",
      )}
    >
      <div className={cx(flat ? "shrink-0 border-b border-[#1A1A1A] pb-4" : "border-b border-[#1A1A1A] px-5 py-5")}>
        <ViewportReveal variant="blur" duration="slow">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">x402 Payments</div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1
              className={cx(
                "min-w-0 font-mono font-semibold leading-tight text-white",
                flat ? "text-[28px]" : "text-[32px]",
              )}
            >
              Payments
            </h1>
            <div className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
              <X402SummaryMetric label="Paid calls" value={String(paidCallCount ?? sortedRecords.length)} />
              <X402SummaryMetric label="Failures" value={String(failureCount)} tone={failureCount > 0 ? "red" : "default"} />
              <X402SummaryMetric
                label="Today"
                value={formatUsdc(dailySpendUsdc ?? latestRecord?.daily_spend_usdc)}
                sub={dailyBudgetUsdc != null ? `/ ${formatUsdc(dailyBudgetUsdc)}` : undefined}
              />
              <X402SummaryMetric
                label="Total"
                value={formatUsdc(totalSpendUsdc ?? latestRecord?.total_spend_usdc)}
                sub={totalBudgetUsdc != null ? `/ ${formatUsdc(totalBudgetUsdc)}` : undefined}
              />
            </div>
          </div>
        </ViewportReveal>
      </div>

      <div
        ref={scrollRef}
        className={cx(
          "console-scroll overflow-x-auto overflow-y-auto",
          flat ? "min-h-0 flex-1" : "max-h-[min(70vh,720px)]",
        )}
      >
        <X402MarketDataPanel rows={marketData} errors={marketDataErrors} scrollRoot={scrollRoot} />

        <table className="min-w-[760px] w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[26%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead className="border-b border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
            <tr>
              {["Time", "Tool", "Amount (USDC)", "Status", "Reason"].map((label) => (
                <th key={label} className="px-3 py-2">
                  <ViewportReveal as="span" variant="fade" duration="fast" className="block truncate">
                    {label}
                  </ViewportReveal>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map((record, index) => {
              const failed = record.outcome === "failure";
              return (
                <tr
                  key={`${record.ts}-${record.tool ?? "tool"}-${index}`}
                  className={cx(
                    "border-b border-[#1A1A1A] text-white",
                    failed && "bg-[#1B0505]/55",
                    !flat && "hover:bg-[#070707]",
                  )}
                >
                  <td className="truncate px-3 py-2 font-mono text-[12px] tabular-nums text-[#A8A8A8]">
                    <ViewportReveal
                      as="span"
                      variant="fade"
                      delay={walletCellDelay(index, "chain")}
                      root={scrollRoot}
                      className="block truncate"
                    >
                      {formatOpenedAt(record.ts)}
                    </ViewportReveal>
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-[12px] font-bold text-[#F2F2F2]">
                    <ViewportReveal
                      as="span"
                      variant={walletColumnVariant("token")}
                      delay={walletCellDelay(index, "token")}
                      root={scrollRoot}
                      className="block truncate"
                    >
                      {record.tool ?? "unknown"}
                    </ViewportReveal>
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-[12px] tabular-nums text-[#D0D0D0]">
                    <ViewportReveal
                      as="span"
                      variant={walletColumnVariant("amount")}
                      delay={walletCellDelay(index, "amount")}
                      root={scrollRoot}
                      className="block truncate"
                    >
                      {formatUsdc(record.amount_usdc)}
                    </ViewportReveal>
                  </td>
                  <td className="px-3 py-2">
                    <ViewportReveal
                      as="span"
                      variant={activityStatusVariant(failed ? "red" : "green")}
                      delay={walletCellDelay(index, "value")}
                      root={scrollRoot}
                      className="flex min-w-0 items-center justify-center gap-1"
                    >
                      <ActivityStatusIndicator
                        status={failed ? "FAILED" : "SUCCESS"}
                        tone={failed ? "red" : "green"}
                        compact
                      />
                    </ViewportReveal>
                  </td>
                  <td
                    className={cx(
                      "truncate px-3 py-2 font-mono text-[12px]",
                      failed ? "text-[#FF7373]" : "text-[#666666]",
                    )}
                    title={record.reason ?? undefined}
                  >
                    <ViewportReveal
                      as="span"
                      variant="fade"
                      delay={walletCellDelay(index, "value")}
                      root={scrollRoot}
                      className="block truncate"
                    >
                      {failed ? record.reason ?? "failure" : "—"}
                    </ViewportReveal>
                  </td>
                </tr>
              );
            })}
            {sortedRecords.length === 0 ? (
              <tr className="border-b border-[#1A1A1A]">
                <td className="px-3 py-4 font-mono text-[12px] text-[#8A8A8A]" colSpan={5}>
                  <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                    {emptyMessage}
                  </ViewportReveal>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function detailValueToneClass(tone: LogEventDetails["items"][number]["tone"]) {
  if (tone === "green") {
    return "text-[#00FF66]";
  }

  if (tone === "yellow") {
    return "text-[#FFD21A]";
  }

  if (tone === "red") {
    return "text-[#FF7373]";
  }

  return "text-[#DADADA]";
}

function ActivityDetailPanel({
  details,
  compact = false,
  readable = false,
}: {
  details: LogEventDetails;
  compact?: boolean;
  readable?: boolean;
}) {
  return (
    <div className={cx("space-y-4", compact ? "" : "px-4 py-4")}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {details.items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className={cx("font-mono uppercase tracking-[0.12em] text-[#757575]", readable ? "text-[11px]" : "text-[10px]")}>
              {item.label}
            </dt>
            <dd
              className={cx(
                "mt-1 break-words font-mono leading-5",
                readable ? "text-[13px]" : "text-[12px]",
                detailValueToneClass(item.tone),
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {details.factors && details.factors.length > 0 ? (
        <div>
          <div className={cx("mb-2 font-mono uppercase tracking-[0.12em] text-[#757575]", readable ? "text-[11px]" : "text-[10px]")}>
            Factor audit · boolean flags from the decision log
          </div>
          <div className="flex flex-wrap gap-2">
            {details.factors.map((factor) => (
              <span
                key={factor.key}
                className={cx(
                  "inline-flex border px-2 py-1 font-mono uppercase tracking-[0.08em]",
                  readable ? "text-[11px]" : "text-[10px]",
                  factor.passed
                    ? "border-[#00FF66]/40 bg-[#001A0A] text-[#00FF66]"
                    : "border-[#FF3737]/40 bg-[#1B0505] text-[#FF7373]",
                )}
              >
                {factor.passed ? "PASS" : "FAIL"} {factor.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {details.x402Evidence && details.x402Evidence.length > 0 ? (
        <div>
          <div className={cx("mb-2 flex items-center gap-2 font-mono uppercase tracking-[0.12em] text-[#757575]", readable ? "text-[11px]" : "text-[10px]")}>
            <span className="border border-[#7A5CFF]/50 bg-[#120A2A] px-1.5 py-0.5 text-[#B9A6FF]">x402</span>
            paid data → algorithm input
          </div>
          <div className="space-y-1.5">
            {details.x402Evidence.map((row) => (
              <div
                key={row.tool + row.factor}
                className={cx(
                  "flex flex-wrap items-center gap-x-2 gap-y-1 border border-[#2A2A2A] bg-black/40 px-2.5 py-1.5 font-mono",
                  readable ? "text-[11px]" : "text-[10px]",
                )}
              >
                <span className="text-[#B9A6FF]">{row.tool}</span>
                <span className="text-[#5C5C5C]">·</span>
                <span className="text-[#9A9A9A]">{row.provides}</span>
                <span className="text-[#5C5C5C]">→</span>
                <span className="text-[#C8C8C8]">{row.factor}</span>
                {row.reading && row.reading !== "—" ? (
                  <span className="text-[#7C7C7C]">[{row.reading}]</span>
                ) : null}
                {row.passed != null ? (
                  <span className={cx("ml-auto", row.passed ? "text-[#00FF66]" : "text-[#FF7373]")}>
                    {row.passed ? "PASS" : "FAIL"}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className={cx("mt-1.5 text-[#5C5C5C]", readable ? "text-[10px]" : "text-[9px]")}>
            Each tool is a 0.01 USDC x402 micropayment to CoinMarketCap; the returned value is what the entry factor above was computed from.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityHeaderCell({
  column,
  label,
  className,
  mode,
  expandable = false,
}: {
  column: "event" | "token" | "reference" | "status";
  label: string;
  className?: string;
  mode: ActivityFeedMode;
  expandable?: boolean;
}) {
  const variant = column === "reference" ? activityReferenceVariant(mode) : activityColumnVariant(column);

  return (
    <th className={className}>
      <ViewportReveal
        as="span"
        variant={variant}
        delay={activityCellDelay(0, column)}
        duration="fast"
        className="block"
      >
        {column === "event" && expandable ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {label}
          </span>
        ) : (
          label
        )}
      </ViewportReveal>
    </th>
  );
}

function ActivityTableRow({
  row,
  index,
  compact,
  dense = false,
  readable = false,
  expandable,
  expanded,
  mode,
  scrollRoot,
  onToggle,
}: {
  row: ActivityRow;
  index: number;
  compact: boolean;
  dense?: boolean;
  readable?: boolean;
  expandable: boolean;
  expanded: boolean;
  mode: ActivityFeedMode;
  scrollRoot: Element | null;
  onToggle?: () => void;
}) {
  const canExpand = expandable && Boolean(row.details);
  const isLead = index === 0;

  return (
    <Fragment>
      <tr
        className={cx(
          "border-b border-[#1A1A1A] text-white",
          canExpand && "cursor-pointer",
          !compact && "hover:bg-[#070707]",
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        <td
          className={cx(
            "font-mono font-bold text-[#F2F2F2]",
            dense
              ? "px-1 py-1.5 text-[9px] leading-4"
              : compact
                ? cx("px-3 py-2", readable ? "text-[14px] leading-5" : "text-[13px]")
                : "px-4 py-5 text-[13px]",
          )}
        >
          <ViewportReveal
            as="span"
            variant={activityLeadEventVariant(index, mode)}
            delay={activityCellDelay(index, "event")}
            duration={isLead ? "slow" : "normal"}
            root={scrollRoot}
            className="flex min-w-0 items-center gap-1.5"
          >
            {expandable ? (
              <span className="shrink-0 text-[#757575]">
                {canExpand ? (
                  expanded ? (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                ) : (
                  <span className="inline-block h-3.5 w-3.5" aria-hidden="true" />
                )}
              </span>
            ) : null}
            <span className="truncate tabular-nums">{formatOpenedAt(row.timestamp)}</span>
          </ViewportReveal>
        </td>
        <td
          className={cx(
            "truncate font-mono text-[#D0D0D0]",
            dense
              ? "px-1 py-1.5 text-[8px] leading-4"
              : compact
                ? cx("px-2 py-2", readable ? "text-[13px] leading-5" : "text-[12px]")
                : "px-2 py-5 text-[12px]",
          )}
        >
          <ViewportReveal
            as="span"
            variant={activityColumnVariant("token")}
            delay={activityCellDelay(index, "token")}
            root={scrollRoot}
            className="inline-flex min-w-0 items-center gap-1.5"
          >
            {row.token ? (
              <>
                <TokenIcon symbol={row.token} size={dense ? 12 : readable ? 16 : 14} />
                <span className="truncate">{row.token}</span>
              </>
            ) : (
              <span className="text-[#666666]">—</span>
            )}
          </ViewportReveal>
        </td>
        <td
          className={cx(
            "truncate font-mono text-[#D0D0D0]",
            dense
              ? "px-1 py-1.5 text-[8px] leading-4"
              : compact
                ? cx("px-2 py-2", readable ? "text-[13px] leading-5" : "text-[12px]")
                : "px-1 py-5 text-[12px]",
          )}
        >
          <ViewportReveal
            as="span"
            variant={activityReferenceVariant(mode)}
            delay={activityCellDelay(index, "reference")}
            root={scrollRoot}
            className="block truncate"
          >
            {row.explorerUrl ? (
              <a
                href={row.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-[#8FD9FF] transition-colors hover:text-white"
                title={row.explorerUrl}
                onClick={(event) => event.stopPropagation()}
              >
                {row.hash}
              </a>
            ) : (
              row.hash
            )}
          </ViewportReveal>
        </td>
        <td className={cx(dense ? "px-1 py-1.5" : compact ? "px-2 py-2" : "px-3 py-4")}>
          <ViewportReveal
            as="span"
            variant={activityStatusVariant(row.tone)}
            delay={activityCellDelay(index, "status")}
            root={scrollRoot}
            className="flex min-w-0 items-center justify-center gap-1"
          >
            <ActivityStatusIndicator status={row.status} tone={row.tone} compact={dense || readable} readable={readable} />
          </ViewportReveal>
        </td>
      </tr>
      {expanded && row.details ? (
        <tr className="border-b border-[#1A1A1A] bg-[#050505]">
          <td colSpan={4}>
            <ViewportReveal variant="fade" delay={40} duration="fast" root={scrollRoot}>
              <ActivityDetailPanel details={row.details} compact={dense} readable={readable} />
            </ViewportReveal>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function RowPaginator({
  page,
  totalPages,
  totalRows,
  pageSize,
  onPageChange,
  compact = false,
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  if (totalRows <= pageSize) {
    return null;
  }

  const start = page * pageSize + 1;
  const end = Math.min(totalRows, (page + 1) * pageSize);

  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-between gap-3 border-t border-[#1A1A1A] bg-black/88 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8A8A8A]",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      <span className="tabular-nums">
        {start}–{end} of {totalRows}
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
          className={cx(
            "transition-colors",
            page === 0 ? "cursor-not-allowed text-[#444444]" : "text-[#B8B8B8] hover:text-white",
          )}
        >
          Prev
        </button>
        <span className="tabular-nums text-[#B8B8B8]">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
          className={cx(
            "transition-colors",
            page >= totalPages - 1 ? "cursor-not-allowed text-[#444444]" : "text-[#B8B8B8] hover:text-white",
          )}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function RecentActivity({
  rows,
  compact = false,
  dense = false,
  expandable = false,
  mode = "logs",
  scrollRoot = null,
  scrollContainerRef,
  className,
  readable = false,
  rowsPerPage = ACTIVITY_ROWS_PER_PAGE,
}: {
  rows: ActivityRow[];
  compact?: boolean;
  dense?: boolean;
  expandable?: boolean;
  mode?: ActivityFeedMode;
  scrollRoot?: Element | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  readable?: boolean;
  rowsPerPage?: number;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = rows.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (page !== safePage) {
      setPage(safePage);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [page, safePage]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPage(0);
    setExpandedIds(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rowsPerPage]);

  const goToPage = (nextPage: number) => {
    setPage(Math.max(0, Math.min(nextPage, totalPages - 1)));
    setExpandedIds(new Set());
  };

  const toggleRow = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div
        ref={scrollContainerRef}
        className={cx(
          "console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto",
          !compact && "max-h-[min(70vh,720px)]",
        )}
      >
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className={expandable ? "w-[28%]" : "w-[26%]"} />
            <col className="w-[18%]" />
            <col className="w-[28%]" />
            <col className="w-[26%]" />
          </colgroup>
          <thead
            className={cx(
              "font-mono font-bold uppercase tracking-[0.12em] text-[#8A8A8A]",
              dense ? "text-[8px]" : readable ? "text-[11px]" : "text-[10px]",
              compact ? "border-b border-[#1A1A1A]" : "border-y border-[#1A1A1A]",
            )}
          >
            <tr>
              <ActivityHeaderCell
                column="event"
                label="Date"
                mode={mode}
                expandable={expandable}
                className={cx(dense ? "px-1 py-1.5" : compact ? "px-3 py-2" : "px-4 py-4")}
              />
              <ActivityHeaderCell
                column="token"
                label="Token"
                mode={mode}
                className={cx(dense ? "px-1 py-1.5" : compact ? "px-2 py-2" : "px-2 py-4")}
              />
              <ActivityHeaderCell
                column="reference"
                label="Reference"
                mode={mode}
                className={cx(dense ? "px-1 py-1.5" : compact ? "px-2 py-2" : "px-1 py-4")}
              />
              <ActivityHeaderCell
                column="status"
                label="Status"
                mode={mode}
                className={cx(dense ? "px-1 py-1.5" : compact ? "px-2 py-2" : "px-3 py-4")}
              />
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, index) => (
              <ActivityTableRow
                key={row.id}
                row={row}
                index={index}
                compact={compact}
                dense={dense}
                readable={readable}
                expandable={expandable}
                expanded={expandable && expandedIds.has(row.id)}
                mode={mode}
                scrollRoot={scrollRoot}
                onToggle={() => toggleRow(row.id)}
              />
            ))}
            {rows.length === 0 ? (
              <tr className="border-b border-[#1A1A1A]">
                <td
                  className={cx(
                    "font-mono text-[#8A8A8A]",
                    dense ? "px-1 py-3 text-[9px]" : compact ? "px-3 py-4 text-[12px]" : "px-4 py-5 text-[12px]",
                  )}
                  colSpan={4}
                >
                  <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                    Waiting for telemetry
                  </ViewportReveal>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <RowPaginator
        page={safePage}
        totalPages={totalPages}
        totalRows={rows.length}
        pageSize={rowsPerPage}
        onPageChange={goToPage}
        compact={compact || dense}
      />
    </div>
  );
}

function MobileLogFeed({
  rows,
  scrollRoot = null,
  scrollContainerRef,
  rowsPerPage = ACTIVITY_LOG_ROWS_PER_PAGE_MOBILE,
}: {
  rows: ActivityRow[];
  scrollRoot?: Element | null;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  rowsPerPage?: number;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = rows.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);
  const rowTrackCount = Math.max(1, pagedRows.length);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (page !== safePage) {
      setPage(safePage);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [page, safePage]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPage(0);
    setExpandedIds(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rows, rowsPerPage]);

  const goToPage = (nextPage: number) => {
    setPage(Math.max(0, Math.min(nextPage, totalPages - 1)));
    setExpandedIds(new Set());
  };

  const toggleRow = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="console-scroll min-h-0 flex-1 overflow-y-auto border-t border-[#202024] bg-black/45"
      >
        {pagedRows.length === 0 ? (
          <div className="px-3 py-4 font-mono text-[12px] text-[#8A8A8A]">
            <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
              Waiting for telemetry
            </ViewportReveal>
          </div>
        ) : (
          <div
            className="grid min-h-full divide-y divide-[#18181C]"
            style={{ gridTemplateRows: `repeat(${rowTrackCount}, minmax(0, 1fr))` }}
          >
            {pagedRows.map((row, index) => {
              const expanded = expandedIds.has(row.id);
              const canExpand = Boolean(row.details);
              const token = row.token ?? tokenFromAmountLabel(row.amount);

              return (
                <div key={row.id} className="min-h-0 bg-[#030303]/70">
                  <button
                    type="button"
                    onClick={canExpand ? () => toggleRow(row.id) : undefined}
                    disabled={!canExpand}
                    className={cx(
                      "grid h-full w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-left",
                      canExpand && "active:bg-[#080808]",
                    )}
                  >
                    <ViewportReveal
                      variant={activityLeadEventVariant(index, "logs")}
                      delay={activityCellDelay(index, "event")}
                      duration={index === 0 ? "slow" : "normal"}
                      root={scrollRoot}
                      className="flex items-center gap-1.5"
                    >
                      <span className="shrink-0 text-[#757575]">
                        {canExpand ? (
                          expanded ? (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          )
                        ) : null}
                      </span>
                      {token ? (
                        <TokenIcon symbol={token} size={18} />
                      ) : (
                        <span className="h-[18px] w-[18px] rounded-full border border-[#2A2A2A]" aria-hidden="true" />
                      )}
                    </ViewportReveal>

                    <ViewportReveal
                      variant={activityColumnVariant("reference")}
                      delay={activityCellDelay(index, "reference")}
                      root={scrollRoot}
                      className="min-w-0"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8A8A]">
                          {row.hash}
                        </span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-[#3A3A3A]" aria-hidden="true" />
                        <span className="truncate font-mono text-[10px] tabular-nums text-[#6F6F6F]">
                          {formatOpenedAt(row.timestamp)}
                        </span>
                      </div>
                      <p
                        className="mt-1 overflow-hidden break-words font-mono text-[11px] font-semibold leading-4 text-[#E6E6E6]"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {row.narrative ?? row.amount}
                      </p>
                    </ViewportReveal>

                    <ViewportReveal
                      variant={activityStatusVariant(row.tone)}
                      delay={activityCellDelay(index, "status")}
                      root={scrollRoot}
                      className="flex justify-end"
                    >
                      <ActivityStatusIndicator status={row.status} tone={row.tone} compact />
                    </ViewportReveal>
                  </button>
                  {expanded && row.details ? (
                    <ViewportReveal variant="fade" delay={40} duration="fast" root={scrollRoot}>
                      <div className="border-t border-[#18181C] px-3 py-3">
                        <ActivityDetailPanel details={row.details} compact />
                      </div>
                    </ViewportReveal>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <RowPaginator
        page={safePage}
        totalPages={totalPages}
        totalRows={rows.length}
        pageSize={rowsPerPage}
        onPageChange={goToPage}
        compact
      />
    </div>
  );
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  if (value >= 100) {
    return usdFormatter.format(value);
  }

  return `$${compactNumberFormatter.format(value)}`;
}

function formatOpenedAt(timestamp: string | null) {
  if (!timestamp) {
    return "N/A";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PositionHeaderCell({
  column,
  label,
  className,
  align = "left",
}: {
  column: PositionColumn;
  label: string;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <th className={className}>
      <ViewportReveal
        as="span"
        variant={positionColumnVariant(column)}
        delay={positionCellDelay(0, column)}
        duration="fast"
        className={cx("block", align === "right" && "text-right")}
      >
        {label}
      </ViewportReveal>
    </th>
  );
}

function PositionTableRow({
  row,
  index,
  compact,
  scrollRoot,
}: {
  row: PositionRow;
  index: number;
  compact: boolean;
  scrollRoot: Element | null;
}) {
  const isLead = index === 0;
  const cellClass = (column: PositionColumn, colorClass = "text-[#D0D0D0]") =>
    cx(
      "truncate font-mono text-[12px] tabular-nums",
      colorClass,
      compact ? "px-2 py-2" : "px-3 py-4",
      column === "token" && (compact ? "px-3 py-2" : "px-5 py-4"),
      column === "opened" && (compact ? "px-3 py-2" : "px-5 py-4"),
    );

  const renderCell = (column: PositionColumn, content: ReactNode, className: string) => (
    <td className={className}>
      <ViewportReveal
        as="span"
        variant={column === "token" && isLead ? positionLeadVariant(index) : positionColumnVariant(column)}
        delay={positionCellDelay(index, column)}
        duration={isLead && column === "token" ? "slow" : "normal"}
        root={scrollRoot}
        className={column === "token" ? "inline-flex min-w-0 items-center gap-1.5" : "block truncate"}
      >
        {content}
      </ViewportReveal>
    </td>
  );

  return (
    <tr className={cx("border-b border-[#1A1A1A] text-white", !compact && "hover:bg-[#070707]")}>
      {renderCell(
        "token",
        <>
          <TokenIcon symbol={row.symbol} size={compact ? 14 : 16} />
          <span className="truncate font-mono text-[13px] font-bold text-[#F2F2F2]">{row.symbol}</span>
          {row.source === "wallet" ? (
            <span className="shrink-0 border border-[#3A3A3A] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#8A8A8A]">
              wallet
            </span>
          ) : null}
        </>,
        cx("font-mono text-[13px] font-bold text-[#F2F2F2]", compact ? "px-3 py-2" : "px-5 py-4"),
      )}
      {renderCell("amount", formatTokenAmount(row.amount), cellClass("amount"))}
      {renderCell("entry", formatPrice(row.entryPrice), cellClass("entry"))}
      {renderCell("value", formatUsd(row.entryValueUsd), cellClass("value"))}
      {renderCell(
        "current",
        formatPrice(row.currentPrice),
        cellClass("current", positivePrice(row.currentPrice) ? "text-[#8FD9FF]" : "text-[#666666]"),
      )}
      {renderCell("high", formatPrice(row.highestPrice), cellClass("high", "text-[#00FF66]"))}
      {renderCell("stop", formatPrice(row.trailingStopPrice), cellClass("stop", "text-[#FFD21A]"))}
      {renderCell("target", formatPrice(row.takeProfitPrice), cellClass("target", "text-[#8FD9FF]"))}
      {renderCell(
        "opened",
        formatOpenedAt(row.openedAt),
        cx(
          "truncate text-right font-mono text-[12px] text-[#A8A8A8]",
          compact ? "px-3 py-2" : "px-5 py-4",
        ),
      )}
    </tr>
  );
}

function ActivePositionsTable({
  rows,
  compact = false,
  scrollRoot = null,
}: {
  rows: PositionRow[];
  compact?: boolean;
  scrollRoot?: Element | null;
}) {
  const headerColumns: Array<{ column: PositionColumn; label: string; className: string; align?: "right" }> = [
    { column: "token", label: "Token", className: cx(compact ? "px-3 py-2" : "px-5 py-4") },
    { column: "amount", label: "Amount", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    { column: "entry", label: "Entry", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    { column: "value", label: "Value", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    { column: "current", label: "Current", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    { column: "high", label: "High", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    { column: "stop", label: "Stop", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    { column: "target", label: "Target", className: cx(compact ? "px-2 py-2" : "px-3 py-4") },
    {
      column: "opened",
      label: "Opened",
      className: cx("text-right", compact ? "px-3 py-2" : "px-5 py-4"),
      align: "right",
    },
  ];

  return (
    <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-[14%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[9%]" />
      </colgroup>
      <thead
        className={cx(
          "font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]",
          compact ? "border-b border-[#1A1A1A]" : "border-y border-[#1A1A1A]",
        )}
      >
        <tr>
          {headerColumns.map((header) => (
            <PositionHeaderCell
              key={header.column}
              column={header.column}
              label={header.label}
              className={header.className}
              align={header.align}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <PositionTableRow
            key={row.id}
            row={row}
            index={index}
            compact={compact}
            scrollRoot={scrollRoot}
          />
        ))}
        {rows.length === 0 ? (
          <tr className="border-b border-[#1A1A1A]">
            <td className={cx("py-6 font-mono text-[12px] text-[#8A8A8A]", compact ? "px-3" : "px-5")} colSpan={9}>
              <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                No open positions in positions.json
              </ViewportReveal>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

type PositionTone = "green" | "yellow" | "blue" | "red" | "neutral";

function positionStatus(row: PositionRow) {
  if (row.source === "wallet") {
    return {
      label: "Wallet-held",
      detail: "Detected in the wallet, not yet matched to positions.json.",
      tone: "yellow" as const,
    };
  }

  if (positivePrice(row.entryPrice) && positivePrice(row.trailingStopPrice) && positivePrice(row.takeProfitPrice)) {
    return {
      label: "Managed",
      detail: "Entry, trailing stop, and target are synced from positions.json.",
      tone: "green" as const,
    };
  }

  return {
    label: "Partial data",
    detail: "Open position is synced, but one or more risk levels are missing.",
    tone: "yellow" as const,
  };
}

function positionToneClass(tone: PositionTone) {
  return {
    green: "text-[#00FF66]",
    yellow: "text-[#FFD21A]",
    blue: "text-[#8FD9FF]",
    red: "text-[#FF7373]",
    neutral: "text-[#D0D0D0]",
  }[tone];
}

function positionBadgeClass(tone: PositionTone) {
  return {
    green: "border-[#00FF66]/40 bg-[#001A0A] text-[#00FF66]",
    yellow: "border-[#FFD21A]/40 bg-[#1B1600] text-[#FFD21A]",
    blue: "border-[#8FD9FF]/40 bg-[#03131C] text-[#8FD9FF]",
    red: "border-[#FF3737]/40 bg-[#1B0505] text-[#FF7373]",
    neutral: "border-[#3A3A3A] bg-[#080808] text-[#A8A8A8]",
  }[tone];
}

function PositionSummaryBlock({
  label,
  value,
  detail,
  tone = "neutral",
  index,
  scrollRoot,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: PositionTone;
  index: number;
  scrollRoot: Element | null;
}) {
  return (
    <ViewportReveal variant="fade" delay={80 + index * 60} root={scrollRoot}>
      <div className="min-w-0 bg-[#050505] px-6 py-5">
        <div className="font-mono text-[10px] uppercase text-[#757575]">{label}</div>
        <div
          className={cx(
            "mt-2 truncate font-mono text-[24px] font-semibold tabular-nums text-white xl:text-[28px]",
            positionToneClass(tone),
          )}
        >
          {value}
        </div>
        {detail ? <div className="mt-1 truncate font-mono text-[11px] text-[#666666]">{detail}</div> : null}
      </div>
    </ViewportReveal>
  );
}

function PositionMetricCell({
  label,
  value,
  column,
  index,
  tone = "neutral",
  valueClassName,
}: {
  label: string;
  value: string;
  column: PositionColumn;
  index: number;
  tone?: PositionTone;
  valueClassName?: string;
}) {
  return (
    <ViewportReveal
      variant={positionColumnVariant(column)}
      delay={positionCellDelay(index, column)}
      duration="fast"
      className="min-w-0 bg-[#030303] px-4 py-3"
    >
      <div className="font-mono text-[10px] uppercase text-[#757575]">{label}</div>
      <div className={cx("mt-1 truncate font-mono text-[14px] tabular-nums", positionToneClass(tone), valueClassName)}>{value}</div>
    </ViewportReveal>
  );
}

function PositionRiskCorridor({ row }: { row: PositionRow }) {
  if (row.source === "wallet") {
    return (
      <div className="border-t border-[#1A1A1A] px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#FFD21A]" aria-hidden="true" />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase text-[#757575]">Position state</div>
            <p className="mt-1 break-words font-mono text-[12px] leading-5 text-[#A8A8A8]">
              Entry, stop, and target are unavailable until the position state syncs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const entry = row.entryPrice;
  const high = row.highestPrice;
  const stop = row.trailingStopPrice;
  const target = row.takeProfitPrice;
  const current = row.currentPrice;
  const { stopDistancePct, targetUpsidePct } = positionRiskStats(row);

  const valid = positivePrice(stop) && positivePrice(target) && target > stop && positivePrice(entry);

  const place = (value: number) =>
    Math.min(100, Math.max(0, ((value - (stop as number)) / ((target as number) - (stop as number))) * 100));

  return (
    <div className="border-t border-[#1A1A1A] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="font-mono text-[10px] uppercase text-[#757575]">Risk corridor</div>
        <div className="font-mono text-[12px] tabular-nums text-[#8A8A8A]">
          {stopDistancePct !== null ? (
            <span className="text-[#FFD21A]">-{stopDistancePct.toFixed(1)}% stop</span>
          ) : (
            <span>stop N/A</span>
          )}
          <span className="mx-2 text-[#3A3A3A]">/</span>
          {targetUpsidePct !== null ? (
            <span className="text-[#8FD9FF]">+{targetUpsidePct.toFixed(1)}% target</span>
          ) : (
            <span>target N/A</span>
          )}
        </div>
      </div>

      {valid ? (
        <>
          <div className="flex items-center gap-4">
            <div className="font-mono text-[10px] uppercase text-[#FFD21A]">Stop</div>
            <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-[#161616]">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[#222222]"
                style={{ width: `${place(entry as number)}%` }}
                aria-hidden="true"
              />
              {positivePrice(high) ? (
                <span
                  className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-[#00FF66]"
                  style={{ left: `${place(high)}%` }}
                  title={`High ${formatPrice(high)}`}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-white"
                style={{ left: `${place(entry as number)}%` }}
                title={`Entry ${formatPrice(entry)}`}
                aria-hidden="true"
              />
              {positivePrice(current) ? (
                <span
                  className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8FD9FF] shadow-[0_0_6px_#8FD9FF]"
                  style={{ left: `${place(current)}%` }}
                  title={`Current ${formatPrice(current)}`}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="font-mono text-[10px] uppercase text-[#8FD9FF]">Target</div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-3 font-mono text-[11px] tabular-nums">
            <div className="min-w-0">
              <div className="text-[#666666]">Stop</div>
              <div className="truncate text-[#FFD21A]">{formatPrice(stop)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[#666666]">Entry</div>
              <div className="truncate text-white">{formatPrice(entry)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[#666666]">Current</div>
              <div className={cx("truncate", positivePrice(current) ? "text-[#8FD9FF]" : "text-[#666666]")}>
                {formatPrice(current)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[#666666]">High</div>
              <div className="truncate text-[#00FF66]">{formatPrice(high)}</div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[#666666]">Target</div>
              <div className="truncate text-[#8FD9FF]">{formatPrice(target)}</div>
            </div>
          </div>
        </>
      ) : (
        <p className="font-mono text-[12px] leading-5 text-[#8A8A8A]">
          Stop and target levels will appear here after the position state is fully synced.
        </p>
      )}
    </div>
  );
}

function findEntryDecisionForPosition(
  row: PositionRow,
  decisions: Decision[],
): Decision | null {
  const symbol = row.symbol.trim().toUpperCase();
  const openedAt = row.openedAt ? Date.parse(row.openedAt) : null;

  const entryDecisions = decisions
    .filter((d) => d.action === "ENTER" && d.symbol?.trim().toUpperCase() === symbol)
    .sort((a, b) => {
      const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
      const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
      return bTime - aTime;
    });

  if (!entryDecisions.length) return null;

  if (openedAt) {
    const match = entryDecisions.find((d) => {
      const dTime = d.timestamp ? Date.parse(d.timestamp) : 0;
      return Math.abs(dTime - openedAt) < 60 * 60 * 1000;
    });
    return match ?? entryDecisions[0];
  }

  return entryDecisions[0];
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1m";
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function positionElapsedTime(openedAt: string | null): string {
  if (!openedAt) return "N/A";
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return "N/A";
  const minutes = (Date.now() - opened) / 60000;
  return formatDuration(minutes);
}

function positionRemainingTime(
  openedAt: string | null,
  holdTimeSeconds: number | null | undefined,
): string | null {
  if (!openedAt || !holdTimeSeconds || !Number.isFinite(holdTimeSeconds)) return null;
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return null;
  const elapsedMs = Date.now() - opened;
  const remainingMs = holdTimeSeconds * 1000 - elapsedMs;
  if (remainingMs <= 0) return "expiring";
  return formatDuration(remainingMs / 60000);
}

function buildPositionsSnapshot(
  data: StatusPayload | null,
  rows: PositionRow[],
  decisions: Decision[],
  totalPositionValue: string,
  agentMode: string,
) {
  const snapshotAt = new Date().toISOString();
  const trackedRows = rows.filter((row) => row.source === "tracked");
  const walletRows = rows.filter((row) => row.source === "wallet");
  const managedRows = rows.filter(
    (row) =>
      positivePrice(row.entryPrice) && positivePrice(row.trailingStopPrice) && positivePrice(row.takeProfitPrice),
  );
  const partialRows = rows.filter((row) => !managedRows.includes(row));

  const positionSymbols = new Set(rows.map((row) => competitionTokenKey(row.symbol)));

  const positions = rows.map((row) => {
    const entryDecision = findEntryDecisionForPosition(row, decisions);
    const riskStats = positionRiskStats(row);
    const status = positionStatus(row);
    const emptyFields = [
      !positivePrice(row.amount) && "amount",
      !positivePrice(row.entryPrice) && "entryPrice",
      !positivePrice(row.entryValueUsd) && "entryValueUsd",
      !positivePrice(row.currentPrice) && "currentPrice",
      !positivePrice(row.highestPrice) && "highestPrice",
      !positivePrice(row.trailingStopPrice) && "trailingStopPrice",
      !positivePrice(row.takeProfitPrice) && "takeProfitPrice",
      !row.openedAt && "openedAt",
    ].filter((field): field is string => typeof field === "string");

    return {
      ...row,
      riskStats,
      status,
      entryDecision,
      emptyFields,
    };
  });

  const entryDecisions = positions.map((p) => p.entryDecision).filter((d): d is Decision => d !== null);

  const relevantExecutions = (data?.executions ?? []).filter((execution) => {
    const toSymbol = execution.to_symbol;
    return toSymbol && positionSymbols.has(competitionTokenKey(toSymbol));
  });

  const relevantBalances = (data?.wallet.balances ?? []).filter((balance) => {
    return positionSymbols.has(competitionTokenKey(balance.symbol));
  });

  const walletErrors = data?.wallet.errors ?? [];
  const telemetryError =
    data?.connection?.error ??
    (walletErrors.length > 0 ? walletErrors.map((e) => `${e.source}: ${e.error}`).join("; ") : null);

  const analysisNotes: string[] = [];
  if (rows.length === 0) {
    analysisNotes.push("No open positions in positions.json or wallet.");
  }
  if (walletRows.length > 0) {
    analysisNotes.push(
      `${walletRows.length} wallet-only position(s) detected without matching positions.json entry.`,
    );
  }
  if (partialRows.length > 0) {
    analysisNotes.push(
      `${partialRows.length} position(s) missing one or more risk levels (entry/stop/target).`,
    );
  }
  if (entryDecisions.length === 0 && rows.length > 0) {
    analysisNotes.push("No matching ENTER decisions found for current positions.");
  }
  if (telemetryError) {
    analysisNotes.push(`Telemetry error: ${telemetryError}`);
  }

  return {
    snapshotAt,
    agentMode,
    summary: {
      totalPositions: rows.length,
      trackedPositions: trackedRows.length,
      walletOnlyPositions: walletRows.length,
      managedPositions: managedRows.length,
      partialPositions: partialRows.length,
      totalExposure: totalPositionValue,
    },
    positions,
    entryDecisions,
    latestDecision: data?.latestDecision ?? null,
    rawPositions: data?.positions ?? null,
    wallet: {
      address: data?.wallet.address ?? null,
      portfolioTotalUsd: data?.wallet.portfolioTotalUsd ?? null,
      relevantBalances,
      errors: walletErrors,
    },
    executions: relevantExecutions,
    guardrails: data?.guardrails ?? null,
    health: data?.health ?? null,
    connection: data?.connection ?? null,
    files: data?.files ?? null,
    telemetryError,
    analysisNotes,
  };
}

function CopyJsonButton({ json }: { json: object }) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // eslint-disable-next-line no-console
      console.warn("Failed to copy positions snapshot to clipboard.");
    }
  }, [json]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-sm border border-[#2A2A2A] bg-[#0A0A0A] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#A8A8A8] transition-colors hover:border-[#3A3A3A] hover:text-white"
    >
      {copied ? (
        <>
          <Check size={12} className="text-[#00FF66]" aria-hidden="true" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={12} aria-hidden="true" />
          <span>Copy JSON</span>
        </>
      )}
    </button>
  );
}

const FACTOR_LABELS: Record<string, string> = {
  volume_breakout: "Volume",
  six_hour_high_break: "High break",
  regime_not_risk_off: "Regime",
  slippage_under_cap: "Slippage",
  rsi_in_range: "RSI",
  derivatives_risk_clear: "Derivatives",
  micro_momentum: "Momentum",
  slippage_ok: "Slippage",
  regime_neutro: "Regime",
  no_whale_dump: "No dump",
  gas_viable: "Gas",
};

function PositionProgressBar({ row }: { row: PositionRow }) {
  const entry = row.entryPrice;
  const stop = row.trailingStopPrice;
  const target = row.takeProfitPrice;
  const current = row.currentPrice;

  if (!positivePrice(stop) || !positivePrice(target) || !positivePrice(entry)) {
    return null;
  }

  const range = (target as number) - (stop as number);
  const currentRaw = positivePrice(current) ? (((current as number) - (stop as number)) / range) * 100 : null;
  const currentPct = currentRaw !== null ? Math.min(100, Math.max(0, currentRaw)) : null;

  const toTargetPct = positivePrice(current)
    ? Math.max(0, ((target as number) - (current as number)) / range) * 100
    : null;
  const toStopPct = positivePrice(current)
    ? Math.max(0, ((current as number) - (stop as number)) / range) * 100
    : null;

  const direction = positivePrice(current) && (current as number) >= (entry as number) ? "target" : "stop";

  return (
    <div className="border-t border-[#1A1A1A] px-5 py-4">
      <div className="mb-3 flex items-center justify-between font-mono">
        <div className="text-[10px] uppercase text-[#757575]">Position distance</div>
        <div className="text-[11px] tabular-nums">
          {toTargetPct !== null && toStopPct !== null ? (
            <span className={direction === "target" ? "text-[#00FF66]" : "text-[#FFD21A]"}>
              {direction === "target"
                ? `${toTargetPct.toFixed(1)}% to target`
                : `${toStopPct.toFixed(1)}% to stop`}
            </span>
          ) : (
            <span className="text-[#666666]">N/A</span>
          )}
        </div>
      </div>
      <div className="relative h-px bg-[#242424]">
        {/* White fill — covering percentage from stop to current */}
        <div
          className="absolute inset-y-0 left-0 bg-white"
          style={{ width: `${currentPct ?? 0}%` }}
        />
        {/* Dot at the end of the fill */}
        {currentPct !== null ? (
          <div
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={{ left: `${currentPct}%` }}
          />
        ) : null}
      </div>
      <div className="mt-2.5 flex justify-between font-mono text-[10px] tabular-nums text-[#555555]">
        <span>Stop {formatPrice(stop)}</span>
        <span>Entry {formatPrice(entry)}</span>
        <span>Target {formatPrice(target)}</span>
      </div>
    </div>
  );
}

function PositionTimeInfo({ row, decision }: { row: PositionRow; decision: Decision | null }) {
  const elapsed = positionElapsedTime(row.openedAt);
  const remaining = positionRemainingTime(row.openedAt, decision?.hold_time_seconds);

  return (
    <div className="flex items-center gap-3 font-mono text-[10px] uppercase text-[#757575]">
      <span>Held: {elapsed}</span>
      {remaining ? (
        <>
          <span className="h-1 w-1 rounded-full bg-[#3A3A3A]" aria-hidden="true" />
          <span className={remaining === "expiring" ? "text-[#FF7373]" : "text-[#8FD9FF]"}>
            {remaining === "expiring" ? "Time stop" : `${remaining} remaining`}
          </span>
        </>
      ) : null}
    </div>
  );
}

function PositionEntryReason({ decision }: { decision: Decision | null }) {
  if (!decision) return null;

  const factors = Object.entries(decision.factor_scores ?? {})
    .filter(([, passed]) => passed)
    .map(([key]) => FACTOR_LABELS[key] ?? key.replace(/_/g, " "));

  return (
    <div className="border-t border-[#1A1A1A] px-5 py-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase text-[#757575]">Entry reason</div>
      <div className="font-mono text-[11px] leading-4 text-[#A8A8A8]">{decision.reason ?? "—"}</div>
      {factors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {factors.map((factor) => (
            <span
              key={factor}
              className="inline-flex items-center gap-1 border border-[#2A2A2A] bg-[#0A0A0A] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-[#8A8A8A]"
            >
              <span className="h-1 w-1 rounded-full bg-[#00FF66]" />
              {factor}
            </span>
          ))}
        </div>
      )}
      {decision.entry_score != null && (
        <div className="mt-2 font-mono text-[10px] text-[#666666]">
          Score: <span className="text-[#DADADA]">{decision.entry_score.toFixed(0)}/100</span>
          {decision.strategy_mode ? ` · ${decision.strategy_mode}` : ""}
        </div>
      )}
      {decision.mlAudit && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className={cx(
            "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em]",
            decision.mlAudit.mlActive
              ? "border-[#2A2A2A] bg-[#00FF66]/10 text-[#00FF66]"
              : decision.mlAudit.mlEnabled
                ? "border-[#2A2A2A] bg-[#FFD700]/10 text-[#FFD700]"
                : "border-[#2A2A2A] bg-[#0A0A0A] text-[#8A8A8A]"
          )}>
            <span className={cx(
              "h-1 w-1 rounded-full",
              decision.mlAudit.mlActive ? "bg-[#00FF66]" : decision.mlAudit.mlEnabled ? "bg-[#FFD700]" : "bg-[#666666]"
            )} />
            ML: {decision.mlAudit.mlRegime ?? "—"} · conf {(decision.mlAudit.mlConfidence != null ? (decision.mlAudit.mlConfidence * 100).toFixed(0) : "—")}% · {decision.mlAudit.mlPasserCount ?? 0} passers
          </span>
          {decision.mlAudit.mlShadowMode && (
            <span className="font-mono text-[9px] text-[#666666]">shadow</span>
          )}
        </div>
      )}
    </div>
  );
}

function DesktopPositionCard({
  row,
  index,
  explorerUrl,
  scrollRoot,
  entryDecision,
}: {
  row: PositionRow;
  index: number;
  explorerUrl: string | null;
  scrollRoot: Element | null;
  entryDecision?: Decision | null;
}) {
  const body = (
    <ViewportReveal
      variant={index === 0 ? positionLeadVariant(index) : "fade"}
      delay={index * 70}
      duration={index === 0 ? "slow" : "normal"}
      root={scrollRoot}
      className="group overflow-hidden border border-[#1A1A1A] bg-black/80 transition-colors hover:border-[#2A2A2A] hover:bg-[#030303]"
    >
      <div className="grid min-h-[220px] grid-cols-1 xl:grid-cols-[minmax(150px,0.32fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col justify-between border-b border-[#1A1A1A] px-5 py-5 xl:border-b-0 xl:border-r">
          {/* Top: date only */}
          <div className="font-mono text-[11px] text-white">
            {row.source === "wallet" ? "Wallet balance" : `Opened ${formatOpenedAt(row.openedAt)}`}
          </div>

          {/* Center: large token icon */}
          <div className="flex flex-1 items-center justify-center py-4">
            <TokenIcon symbol={row.symbol} size={72} />
          </div>

          {/* Explorer indicator */}
          {explorerUrl ? (
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-[#757575]">
              <span>BSC</span>
              <ExternalLink size={10} />
            </div>
          ) : null}

          {/* Bottom stats */}
          <div className="mt-5 grid grid-cols-3 gap-px bg-[#141416]">
            <div className="min-w-0 bg-[#050505] px-3 py-3">
              <div className="font-mono text-[10px] uppercase text-[#757575]">Amount</div>
              <div className="mt-1 truncate font-mono text-[15px] tabular-nums text-[#D0D0D0]">
                {formatTokenAmount(row.amount)}
              </div>
            </div>
            <div className="min-w-0 bg-[#050505] px-3 py-3">
              <div className="font-mono text-[10px] uppercase text-[#757575]">Value</div>
              <div className="mt-1 truncate font-mono text-[15px] tabular-nums text-white">
                {formatUsd(row.entryValueUsd)}
              </div>
            </div>
            <div className="min-w-0 bg-[#050505] px-3 py-3">
              <div className="font-mono text-[10px] uppercase text-[#757575]">Current</div>
              <div
                className={cx(
                  "mt-1 truncate font-mono text-[15px] tabular-nums",
                  positivePrice(row.currentPrice) ? "text-[#8FD9FF]" : "text-[#666666]",
                )}
                title={positivePrice(row.currentPrice) ? `Live price ${formatPrice(row.currentPrice)}` : undefined}
              >
                {formatPrice(row.currentPrice)}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-4 gap-px bg-[#141416]">
            <PositionMetricCell label="Entry" value={formatPrice(row.entryPrice)} column="entry" index={index} valueClassName="font-bold text-white" />
            <PositionMetricCell
              label="High"
              value={formatPrice(row.highestPrice)}
              column="high"
              index={index}
              tone="neutral"
              valueClassName="text-white/60"
            />
            <PositionMetricCell
              label="Stop"
              value={formatPrice(row.trailingStopPrice)}
              column="stop"
              index={index}
              tone="neutral"
              valueClassName="text-white/60"
            />
            <PositionMetricCell
              label="Target"
              value={formatPrice(row.takeProfitPrice)}
              column="target"
              index={index}
              valueClassName="font-bold text-white"
            />
          </div>
          <PositionProgressBar row={row} />
          <PositionEntryReason decision={entryDecision ?? null} />
        </div>
      </div>
    </ViewportReveal>
  );

  if (explorerUrl) {
    return (
      <a
        href={explorerUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`View ${row.symbol} on BscScan`}
        title={`View ${row.symbol} on BscScan`}
        className="block"
      >
        {body}
      </a>
    );
  }

  return <div>{body}</div>;
}

function PositionsInsightRail({
  rows,
  nearestStop,
  nearestTarget,
  totalPositionValue,
  scrollRoot,
}: {
  rows: PositionRow[];
  nearestStop: ({ row: PositionRow } & ReturnType<typeof positionRiskStats>) | undefined;
  nearestTarget: ({ row: PositionRow } & ReturnType<typeof positionRiskStats>) | undefined;
  totalPositionValue: string;
  scrollRoot: Element | null;
}) {
  const trackedRows = rows.filter((row) => row.source === "tracked");
  const walletRows = rows.filter((row) => row.source === "wallet");
  const managedRows = rows.filter(
    (row) => positivePrice(row.entryPrice) && positivePrice(row.trailingStopPrice) && positivePrice(row.takeProfitPrice),
  );

  const railRows = [
    { label: "Total exposure", value: totalPositionValue, tone: "neutral" as const },
    {
      label: "Risk coverage",
      value: `${managedRows.length}/${rows.length}`,
      tone: managedRows.length === rows.length ? ("green" as const) : ("yellow" as const),
    },
    {
      label: "Synced positions",
      value: String(trackedRows.length),
      tone: trackedRows.length > 0 ? ("green" as const) : ("neutral" as const),
    },
    { label: "Wallet-only", value: String(walletRows.length), tone: walletRows.length > 0 ? ("yellow" as const) : ("neutral" as const) },
  ];

  return (
    <aside className="min-w-0 border border-[#1A1A1A] bg-black/70">
      <ViewportReveal variant="fade" delay={160} root={scrollRoot}>
        <div className="border-b border-[#1A1A1A] px-5 py-4">
          <div className="font-mono text-[10px] uppercase text-[#757575]">Position readout</div>
          <div className="mt-1 font-mono text-[18px] font-semibold text-white">Exposure & state</div>
        </div>
      </ViewportReveal>

      <div className="divide-y divide-[#141416]">
        {railRows.map((item, index) => (
          <ViewportReveal
            key={item.label}
            variant={index % 2 === 0 ? "left" : "right"}
            delay={220 + index * 45}
            duration="fast"
            root={scrollRoot}
            className="flex items-baseline justify-between gap-4 px-5 py-3"
          >
            <span className="font-mono text-[11px] uppercase text-[#757575]">{item.label}</span>
            <span className={cx("truncate font-mono text-[14px] tabular-nums", positionToneClass(item.tone))}>
              {item.value}
            </span>
          </ViewportReveal>
        ))}
      </div>

      <ViewportReveal variant="fade" delay={440} root={scrollRoot} className="border-t border-[#1A1A1A] px-5 py-4">
        <div className="font-mono text-[10px] uppercase text-[#757575]">Closest levels</div>
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-3 font-mono">
              <span className="text-[11px] uppercase text-[#757575]">Stop</span>
              <span className="text-[13px] tabular-nums text-[#FFD21A]">
                {nearestStop ? `${nearestStop.row.symbol} -${(nearestStop.stopDistancePct as number).toFixed(1)}%` : "N/A"}
              </span>
            </div>
            <div className="mt-2 h-px bg-[#242424]">
              <div className="h-px w-1/3 bg-[#FFD21A]" aria-hidden="true" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-3 font-mono">
              <span className="text-[11px] uppercase text-[#757575]">Target</span>
              <span className="text-[13px] tabular-nums text-[#8FD9FF]">
                {nearestTarget
                  ? `${nearestTarget.row.symbol} +${(nearestTarget.targetUpsidePct as number).toFixed(1)}%`
                  : "N/A"}
              </span>
            </div>
            <div className="mt-2 h-px bg-[#242424]">
              <div className="h-px w-2/3 bg-[#8FD9FF]" aria-hidden="true" />
            </div>
          </div>
        </div>
      </ViewportReveal>
    </aside>
  );
}

function DesktopPositionsBoard({
  rows,
  executions,
  walletAddress,
  totalPositionValue,
  scrollRoot,
  scrollRef,
  decisions = [],
  headerAction,
}: {
  rows: PositionRow[];
  executions: StatusPayload["executions"];
  walletAddress: string | null;
  totalPositionValue: string;
  scrollRoot: Element | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  decisions?: Decision[];
  headerAction?: ReactNode;
}) {
  const stats = rows.map((row) => ({ row, ...positionRiskStats(row) }));
  const nearestStop = stats
    .filter((item) => item.stopDistancePct !== null)
    .sort((a, b) => (a.stopDistancePct as number) - (b.stopDistancePct as number))[0];
  const nearestTarget = stats
    .filter((item) => item.targetUpsidePct !== null)
    .sort((a, b) => (a.targetUpsidePct as number) - (b.targetUpsidePct as number))[0];

  const walletOnlyCount = rows.filter((row) => row.source === "wallet").length;
  const managedCount = rows.filter(
    (row) => positivePrice(row.entryPrice) && positivePrice(row.trailingStopPrice) && positivePrice(row.takeProfitPrice),
  ).length;

  const summaryBlocks: Array<{
    label: string;
    value: string;
    detail?: string;
    tone?: PositionTone;
  }> = [
    { label: "Open positions", value: String(rows.length), detail: `${managedCount} with risk plan` },
    { label: "Total exposure", value: totalPositionValue, detail: "Current token value" },
    {
      label: nearestStop ? "Nearest stop" : "Risk coverage",
      value: nearestStop ? `${nearestStop.row.symbol} -${(nearestStop.stopDistancePct as number).toFixed(1)}%` : `${managedCount}/${rows.length}`,
      detail: nearestStop ? formatPrice(nearestStop.row.trailingStopPrice) : "Stops and targets synced",
      tone: nearestStop ? "yellow" : managedCount === rows.length ? "green" : "yellow",
    },
    {
      label: nearestTarget ? "Nearest target" : "Sync status",
      value: nearestTarget
        ? `${nearestTarget.row.symbol} +${(nearestTarget.targetUpsidePct as number).toFixed(1)}%`
        : walletOnlyCount > 0
          ? `${walletOnlyCount} wallet-only`
          : "N/A",
      detail: nearestTarget ? formatPrice(nearestTarget.row.takeProfitPrice) : "Waiting for positions.json levels",
      tone: nearestTarget ? "blue" : walletOnlyCount > 0 ? "yellow" : "neutral",
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
          <div className="font-mono text-[22px] font-semibold uppercase tracking-[0.18em] text-[#3A3A3A]">
            No open positions
          </div>
          <div className="mt-3 font-mono text-[13px] text-[#5A5A5A]">
            positions.json is empty — the agent scans every 5 minutes
          </div>
        </ViewportReveal>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[#1A1A1A] px-6 py-2.5">
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="text-[#757575]">
            Positions: <span className="text-white">{rows.length}</span>
          </span>
          <span className="h-1 w-px bg-[#333]" />
          <span className="text-[#757575]">
            Exposure: <span className="text-white">{totalPositionValue}</span>
          </span>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="min-w-0">
          {rows.map((row, index) => (
            <DesktopPositionCard
              key={row.id}
              row={row}
              index={index}
              explorerUrl={positionExplorerUrl(row, executions, walletAddress)}
              scrollRoot={scrollRoot}
              entryDecision={findEntryDecisionForPosition(row, decisions)}
            />
          ))}
        </div>
        {/* PositionsInsightRail — sidebar hidden for full-width rows
        <PositionsInsightRail
          rows={rows}
          nearestStop={nearestStop}
          nearestTarget={nearestTarget}
          totalPositionValue={totalPositionValue}
          scrollRoot={scrollRoot}
        />
        */}
      </div>
    </div>
  );
}

function ActivePositionsPanel({
  rows,
  totalPositionValue,
  agentMode,
  executions = [],
  walletAddress = null,
  compact = false,
  desktop = false,
  decisions = [],
  data = null,
}: {
  rows: PositionRow[];
  totalPositionValue: string;
  agentMode: string;
  executions?: StatusPayload["executions"];
  walletAddress?: string | null;
  compact?: boolean;
  desktop?: boolean;
  decisions?: Decision[];
  data?: StatusPayload | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const flat = panelUsesFlatChrome(compact, desktop);
  const tableCompact = flat;

  const snapshot = useMemo(
    () => buildPositionsSnapshot(data, rows, decisions, totalPositionValue, agentMode),
    [data, rows, decisions, totalPositionValue, agentMode],
  );
  const copyButton = <CopyJsonButton json={snapshot} />;

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <section
      className={cx(
        "flex min-h-0 flex-col overflow-hidden",
        compact && "flex-1 px-4 pt-4",
        desktop && "flex-1",
        !flat && "px-10 py-9",
      )}
    >
      {!flat ? (
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <ViewportReveal variant="fade" delay={100}>
              <div className="border border-[#2A2A2A] bg-black/88 px-5 py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Open positions</div>
                <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums text-white">{rows.length}</div>
              </div>
            </ViewportReveal>
            <ViewportReveal variant="scale" delay={160} duration="slow">
              <div className="border border-[#2A2A2A] bg-black/88 px-5 py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Total position value</div>
                <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums text-white">{totalPositionValue}</div>
              </div>
            </ViewportReveal>
          </div>
          <div className="hidden shrink-0 sm:block">{copyButton}</div>
        </div>
      ) : null}

      {!flat ? (
        <ViewportReveal variant="fade" delay={200}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div ref={scrollRef} className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
              <ActivePositionsTable rows={rows} compact={tableCompact} scrollRoot={scrollRoot} />
            </div>
          </div>
        </ViewportReveal>
      ) : desktop && !compact ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DesktopPositionsBoard
            rows={rows}
            executions={executions}
            walletAddress={walletAddress}
            totalPositionValue={totalPositionValue}
            scrollRoot={scrollRoot}
            scrollRef={scrollRef}
            decisions={decisions}
            headerAction={copyButton}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[#2A2A2A] bg-black/88 px-4 py-2.5">
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[#757575]">
              <span>
                Positions: <span className="text-white">{rows.length}</span>
              </span>
              <span className="h-1 w-px bg-[#333]" />
              <span>
                Exposure: <span className="text-white">{totalPositionValue}</span>
              </span>
            </div>
            {copyButton}
          </div>
          <div className="mt-0 flex min-h-0 flex-1 flex-col border border-t-0 border-[#2A2A2A] bg-black/88">
            <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
              <ActivePositionsTable rows={rows} compact={tableCompact} scrollRoot={scrollRoot} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function useNow(tickMs = 1000) {
  return useSyncExternalStore(
    (onStoreChange) => {
      const interval = window.setInterval(onStoreChange, tickMs);
      return () => window.clearInterval(interval);
    },
    () => Date.now(),
    () => Date.now(),
  );
}

function LiveScanPanel({
  latestDecision,
  decisions,
  agentRunning,
  compact = false,
  mobileFit = false,
  mobileTabs = null,
  readable = false,
}: {
  latestDecision: StatusPayload["latestDecision"];
  decisions: StatusPayload["decisions"];
  agentRunning: boolean;
  compact?: boolean;
  mobileFit?: boolean;
  mobileTabs?: ReactNode;
  readable?: boolean;
}) {
  const now = useNow();
  const intervalMs = useMemo(() => inferCycleIntervalMs(decisions), [decisions]);
  const nextAt = useMemo(
    () => nextCycleAt(latestDecision?.timestamp, intervalMs),
    [intervalMs, latestDecision?.timestamp],
  );
  const remainingMs = cycleCountdownMs(nextAt, now);
  const countdownLabel =
    remainingMs === null
      ? "N/A"
      : remainingMs <= 0
        ? agentRunning
          ? "Scanning…"
          : "Due now"
        : formatCycleCountdown(remainingMs);

  const analysis = latestDecision ? detailsFromDecision(latestDecision) : null;
  const strategyMode = latestDecision ? resolveStrategyMode(latestDecision) : null;
  const symbol = latestDecision?.symbol ?? null;
  const sectionGap = mobileFit ? "mt-2 border-t border-[#1A1A1A] pt-2" : cx("mt-4 border-t border-[#1A1A1A] pt-4", compact && "mt-3 pt-3");
  const labelClass = mobileFit
    ? "font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]"
    : cx("font-mono uppercase tracking-[0.14em] text-[#8A8A8A]", readable ? "text-[11px]" : "text-[10px]");

  return (
    <div
      className={cx(
        !mobileFit && "border border-[#2A2A2A] bg-black/88",
        mobileFit && "flex min-h-0 flex-col overflow-hidden px-3 py-3 shadow-[0_0_24px_rgba(255,255,255,0.04)]",
        !mobileFit && compact && "px-4 py-4",
        !mobileFit && !compact && "px-5 py-5",
      )}
    >
      {mobileFit ? (
        <div className="flex shrink-0 items-start justify-between gap-3 pb-2">
          <div className="font-mono text-[11px] leading-none text-[#8A8A8A]">
            Cycle #{latestDecision?.cycle_number ?? "N/A"}
          </div>
          {mobileTabs}
        </div>
      ) : null}
      {mobileFit ? (
        <div className="flex shrink-0 items-stretch gap-2 border-b border-[#1A1A1A] pb-2">
          <div className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center rounded-sm border border-[#181818] bg-[#050505]/80 px-2 py-2 text-center">
            <div className={labelClass}>Next query</div>
            <div
              className={cx(
                "mt-1 font-mono text-[24px] font-semibold tabular-nums leading-none",
                remainingMs !== null && remainingMs <= 0 && agentRunning ? "text-[#FFD21A]" : "text-white",
              )}
            >
              {countdownLabel}
            </div>
          </div>
          {symbol ? (
            <>
              <div className="relative flex min-w-0 flex-1 basis-0 items-center justify-center overflow-hidden rounded-sm border border-[#333333] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.14),rgba(255,255,255,0.03)_42%,rgba(0,0,0,0)_72%)] px-2 py-2 shadow-[inset_0_0_18px_rgba(255,255,255,0.06)]">
                <span className="pointer-events-none absolute inset-x-3 top-1 h-px bg-white/35" aria-hidden="true" />
                <span className="pointer-events-none absolute -bottom-8 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-[#FF173D]/20 blur-xl" aria-hidden="true" />
                <div className="relative flex max-w-full items-center gap-2">
                  <TokenIcon symbol={symbol} size={42} />
                  <div className="min-w-0 text-center">
                    <div className="truncate font-mono text-[18px] font-semibold leading-tight text-white">{symbol}</div>
                    {latestDecision?.priced_target_count != null ? (
                      <div className="mt-1 truncate font-mono text-[11px] leading-tight text-[#8A8A8A]">
                        {latestDecision.priced_target_count} targets priced
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="flex min-w-0 flex-1 basis-0 items-center justify-center rounded-sm border border-[#181818] bg-[#050505]/80 px-2 py-2 text-center font-mono text-[10px] leading-4 text-[#8A8A8A]">
                Waiting for decision…
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div>
            <div className={labelClass}>Next query</div>
            <div
              className={cx(
                "mt-1 font-mono text-[24px] font-semibold tabular-nums leading-none",
                remainingMs !== null && remainingMs <= 0 && agentRunning ? "text-[#FFD21A]" : "text-white",
              )}
            >
              {countdownLabel}
            </div>
          </div>

          <div className={sectionGap}>
            <div className={labelClass}>Detected asset</div>
            {symbol ? (
              <div className="mt-3 flex items-center gap-3.5">
                <TokenIcon symbol={symbol} size={compact ? 40 : 48} />
                <div className="min-w-0">
                  <div className={cx("font-mono font-semibold leading-none text-white", readable ? "text-[20px]" : "text-[18px]")}>{symbol}</div>
                  <div className={cx("mt-1 font-mono text-[#8A8A8A]", readable ? "text-[12px]" : "text-[11px]")}>
                    Cycle #{latestDecision?.cycle_number ?? "N/A"}
                    {latestDecision?.priced_target_count != null
                      ? ` · ${latestDecision.priced_target_count} targets priced`
                      : ""}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 font-mono text-[12px] leading-5 text-[#8A8A8A]">Waiting for the next decision row…</p>
            )}
          </div>
        </>
      )}

      <div className={mobileFit ? "flex shrink-0 flex-col gap-1 pt-1.5" : sectionGap}>
        {!mobileFit ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className={labelClass}>Signal inputs</div>
            {strategyMode ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#666666]">{strategyMode}</span>
            ) : null}
          </div>
        ) : null}

        {analysis?.factors && analysis.factors.length > 0 ? (
          <ul
            className={cx(
              mobileFit ? "grid grid-cols-2 justify-items-center gap-x-2 gap-y-1" : "space-y-1.5",
            )}
          >
            {analysis.factors.map((factor) => (
              <li
                key={factor.key}
                className={cx(
                  "flex min-w-0 items-start font-mono text-[#8A8A8A]",
                  mobileFit
                    ? "justify-center gap-1.5 text-[11px] leading-5"
                    : cx("gap-2 leading-5", readable ? "text-[13px]" : "text-[11px]"),
                )}
              >
                <span className="mt-px shrink-0" aria-hidden="true">
                  {factor.passed ? "✓" : "✗"}
                </span>
                <span className="uppercase tracking-[0.04em]">{factor.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p
            className={cx(
              "font-mono leading-5 text-[#8A8A8A]",
              mobileFit ? "text-center text-[12px]" : readable ? "text-[13px]" : "text-[12px]",
            )}
          >
            {latestDecision?.reason?.trim()
              ? latestDecision.reason
              : "Signal audit will appear after the agent completes a scan cycle."}
          </p>
        )}

        {latestDecision?.reason ? (
          <p
            className={cx(
              "break-words font-mono text-[#A8A8A8]",
              mobileFit
                ? "shrink-0 text-center text-[11px] font-semibold leading-5"
                : cx("mt-3 leading-5", readable ? "text-[13px]" : "text-[11px]"),
            )}
          >
            {latestDecision.reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
    () => false,
  );
}

type ScanFactor = { key: string; label: string; passed: boolean; reading?: string | null };

const SCAN_STEP_MS = 540;

/**
 * Sequentially "analyses" each factor: a sweep beam travels the list, each row
 * flips from pending → analysing → resolved (pass/fail), one at a time. Re-runs
 * whenever `runKey` (symbol + cycle) changes so judges watch the agent think.
 */
function LiveFactorScan({
  factors,
  runKey,
  readable = false,
}: {
  factors: ScanFactor[];
  runKey: string;
  readable?: boolean;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const [resolved, setResolved] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    if (factors.length === 0) {
      timers.push(window.setTimeout(() => !cancelled && setResolved(0), 0));
    } else if (reduceMotion) {
      timers.push(window.setTimeout(() => !cancelled && setResolved(factors.length), 0));
    } else {
      timers.push(window.setTimeout(() => !cancelled && setResolved(0), 0));
      for (let i = 0; i < factors.length; i += 1) {
        const timer = window.setTimeout(
          () => {
            if (!cancelled) {
              setResolved((current) => Math.max(current, i + 1));
            }
          },
          SCAN_STEP_MS * (i + 1),
        );
        timers.push(timer);
      }
    }
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [runKey, factors.length, reduceMotion]);

  const activeIndex = resolved < factors.length ? resolved : -1;
  const scanning = activeIndex !== -1;
  const valueText = readable ? "text-[13px]" : "text-[12px]";

  return (
    <div className="relative">
      {scanning ? (
        <span
          aria-hidden="true"
          className="scan-beam pointer-events-none absolute inset-x-0 top-0 h-6 bg-[linear-gradient(180deg,rgba(255,210,26,0)_0%,rgba(255,210,26,0.12)_50%,rgba(255,210,26,0)_100%)]"
        />
      ) : null}
      <ul className="relative space-y-1">
        {factors.map((factor, index) => {
          const isResolved = index < resolved;
          const isActive = index === activeIndex;
          const tone = factor.passed ? "text-[#00FF66]" : "text-[#FF6B6B]";

          return (
            <li
              key={factor.key}
              className={cx(
                "rounded-sm px-2 py-1.5 font-mono transition-colors duration-300",
                valueText,
                isActive && "scan-row-active",
                isResolved && "scan-row-resolve",
                !isResolved && !isActive && "opacity-35",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isResolved ? (
                    <span className={cx("text-[13px] font-bold leading-none", tone)}>
                      {factor.passed ? "✓" : "✗"}
                    </span>
                  ) : isActive ? (
                    <span className="scan-pulse inline-block h-2 w-2 rounded-full bg-[#FFD21A] shadow-[0_0_8px_rgba(255,210,26,0.7)]" />
                  ) : (
                    <span className="inline-block h-1 w-1 rounded-full bg-[#3A3A3A]" />
                  )}
                </span>
                <span
                  className={cx(
                    "min-w-0 flex-1 truncate uppercase tracking-[0.06em]",
                    isResolved ? "text-[#C8C8C8]" : isActive ? "text-white" : "text-[#6A6A6A]",
                  )}
                >
                  {factor.label}
                </span>
                <span
                  className={cx(
                    "shrink-0 text-[10px] uppercase tracking-[0.12em]",
                    isResolved ? tone : isActive ? "text-[#FFD21A]" : "text-[#3A3A3A]",
                  )}
                >
                  {isResolved ? (factor.passed ? "PASS" : "FAIL") : isActive ? "SCAN" : "···"}
                </span>
              </div>
              {isResolved ? (
                <div className="mt-1 pl-7">
                  {factor.reading ? (
                    <p
                      className={cx(
                        "text-[11px] leading-4 tabular-nums",
                        factor.passed ? "text-[#9AD3B0]" : "text-[#D89A9A]",
                      )}
                    >
                      {factor.reading}
                    </p>
                  ) : null}
                  <p className="text-[11px] leading-4 text-[#6A6A6A]">
                    {explainFactor(factor.key, factor.passed)}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Redesigned desktop left column: the detected token sits up top with the
 * next-query countdown, then every signal factor is analysed live, and a verdict
 * resolves once the scan completes.
 */
function LiveDecisionScan({
  latestDecision,
  decisions,
  agentRunning,
}: {
  latestDecision: StatusPayload["latestDecision"];
  decisions: StatusPayload["decisions"];
  agentRunning: boolean;
}) {
  const now = useNow();
  const reduceMotion = usePrefersReducedMotion();
  const intervalMs = useMemo(() => inferCycleIntervalMs(decisions), [decisions]);
  const nextAt = useMemo(
    () => nextCycleAt(latestDecision?.timestamp, intervalMs),
    [intervalMs, latestDecision?.timestamp],
  );
  const remainingMs = cycleCountdownMs(nextAt, now);
  const countdownLabel =
    remainingMs === null
      ? "N/A"
      : remainingMs <= 0
        ? agentRunning
          ? "Scanning…"
          : "Due now"
        : formatCycleCountdown(remainingMs);
  const countdownDue = remainingMs !== null && remainingMs <= 0 && agentRunning;

  const analysis = useMemo(
    () => (latestDecision ? detailsFromDecision(latestDecision) : null),
    [latestDecision],
  );
  const factors: ScanFactor[] = useMemo(() => {
    const metrics = latestDecision?.factor_metrics ?? null;
    return (analysis?.factors ?? []).map((factor) => ({
      ...factor,
      reading: metrics?.[factor.key] ?? null,
    }));
  }, [analysis, latestDecision]);
  const strategyMode = latestDecision ? resolveStrategyMode(latestDecision) : null;
  const symbol = latestDecision?.symbol ?? null;
  const runKey = `${symbol ?? "none"}-${latestDecision?.cycle_number ?? "0"}`;

  // Mirror the scan timeline so the verdict only appears once factors resolve.
  const [scanDone, setScanDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    if (factors.length === 0) {
      timers.push(window.setTimeout(() => !cancelled && setScanDone(false), 0));
    } else if (reduceMotion) {
      timers.push(window.setTimeout(() => !cancelled && setScanDone(true), 0));
    } else {
      timers.push(window.setTimeout(() => !cancelled && setScanDone(false), 0));
      timers.push(
        window.setTimeout(
          () => !cancelled && setScanDone(true),
          SCAN_STEP_MS * (factors.length + 0.5),
        ),
      );
    }
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [runKey, factors.length, reduceMotion]);

  const passedCount = factors.filter((factor) => factor.passed).length;
  const actionTone = latestDecision ? decisionActionTone(latestDecision.action) : "yellow";
  const labelClass = "font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]";

  const scoreStats = latestDecision ? breakoutEntryScoreStats(latestDecision) : null;
  const entryScoreReading =
    latestDecision?.factor_metrics?.entry_score ??
    (scoreStats?.score != null
      ? `${scoreStats.score.toFixed(1)}/100 · need ${scoreStats.required}+ · floor ${scoreStats.quoteFloor}`
      : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col border border-[#2A2A2A] bg-black/88">
      {/* Detected asset + next query */}
      <div className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-4 border-b border-[#1A1A1A] px-5 py-4">
        <div className="min-w-0">
          <div className={labelClass}>Detected asset</div>
          {symbol ? (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="relative">
                <TokenIcon symbol={symbol} size={44} />
                {agentRunning ? (
                  <span className="scan-pulse absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-black bg-[#FFD21A]" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="truncate font-mono text-[22px] font-semibold leading-none text-white">{symbol}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-[#8A8A8A]">
                  Cycle #{latestDecision?.cycle_number ?? "N/A"}
                  {latestDecision?.priced_target_count != null
                    ? ` · ${latestDecision.priced_target_count} priced`
                    : ""}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-2 font-mono text-[12px] leading-5 text-[#8A8A8A]">Waiting for the next decision row…</p>
          )}
        </div>
        <div className="flex flex-col items-end text-right">
          <div className={labelClass}>Next query</div>
          <div
            className={cx(
              "mt-1 font-mono text-[26px] font-semibold tabular-nums leading-none",
              countdownDue ? "text-[#FFD21A]" : "text-white",
            )}
          >
            {countdownLabel}
          </div>
        </div>
      </div>

      {/* Live analysis header */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <span
            className={cx(
              "inline-block h-1.5 w-1.5 rounded-full",
              scanDone ? "bg-[#00FF66] shadow-[0_0_6px_rgba(0,255,102,0.5)]" : "scan-pulse bg-[#FFD21A]",
            )}
          />
          <span className={labelClass}>{scanDone ? "Signal analysis" : "Analyzing signals"}</span>
        </div>
        <div className="flex items-center gap-3">
          {strategyMode ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#666666]">{strategyMode}</span>
          ) : null}
          {factors.length > 0 ? (
            <span className="font-mono text-[11px] tabular-nums text-[#8A8A8A]">
              <span className={passedCount > 0 ? "text-[#00FF66]" : "text-[#8A8A8A]"}>{passedCount}</span>
              <span className="text-[#3A3A3A]">/</span>
              {factors.length}
            </span>
          ) : null}
        </div>
      </div>

      {/* Entry score reading */}
      {entryScoreReading ? (
        <div className="shrink-0 px-5 pb-1">
          <div className="flex items-center justify-between gap-2 border-b border-[#141414] pb-2">
            <span className={labelClass}>Entry score</span>
            <span
              className={cx(
                "font-mono text-[11px] tabular-nums",
                scoreStats?.scoreMet ? "text-[#00FF66]" : "text-[#D89A9A]",
              )}
            >
              {entryScoreReading}
            </span>
          </div>
        </div>
      ) : null}

      {/* Factor scan */}
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {factors.length > 0 ? (
          <LiveFactorScan factors={factors} runKey={runKey} readable />
        ) : (
          <p className="px-2 py-3 font-mono text-[12px] leading-5 text-[#8A8A8A]">
            {latestDecision?.reason?.trim()
              ? latestDecision.reason
              : "Signal audit will appear after the agent completes a scan cycle."}
          </p>
        )}
      </div>

      {/* Verdict */}
      {latestDecision?.action ? (
        <div className="shrink-0 border-t border-[#1A1A1A] px-5 py-4">
          {scanDone ? (
            <div className="scan-verdict-in">
              <div className="flex items-center gap-2.5">
                <StatusBadge status={latestDecision.action} tone={actionTone} />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Decision</span>
              </div>
              {latestDecision.reason?.trim() ? (
                <p className="mt-2.5 break-words font-mono text-[12px] leading-5 text-[#A8A8A8]">
                  {latestDecision.reason}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#FFD21A]">
              <span className="scan-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#FFD21A]" />
              Resolving decision…
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Minimal Activity view: token + name on the left, the factor list on the
 * right — laid out horizontally, no animations. A single button flips over to
 * the historical log ("past").
 */
function SimpleLiveScan({
  latestDecision,
  onViewPast,
}: {
  latestDecision: StatusPayload["latestDecision"];
  onViewPast: () => void;
}) {
  const analysis = useMemo(
    () => (latestDecision ? detailsFromDecision(latestDecision) : null),
    [latestDecision],
  );
  const factors: ScanFactor[] = useMemo(() => {
    const metrics = latestDecision?.factor_metrics ?? null;
    return (analysis?.factors ?? []).map((factor) => ({
      ...factor,
      reading: metrics?.[factor.key] ?? null,
    }));
  }, [analysis, latestDecision]);

  const symbol = latestDecision?.symbol ?? null;
  const passedCount = factors.filter((factor) => factor.passed).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar: past toggle */}
      <div className="flex shrink-0 justify-end pb-8">
        <button
          type="button"
          onClick={onViewPast}
          className="group inline-flex items-center gap-2 border border-[#2A2A2A] bg-black/40 px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9A9A9A] transition-colors hover:border-[#3F3F3F] hover:text-white"
        >
          View past
          <span aria-hidden="true" className="text-[#666666] transition-colors group-hover:text-[#FFD21A]">
            →
          </span>
        </button>
      </div>

      {symbol ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Row 1: token + name */}
          <div className="flex shrink-0 flex-col items-center text-center">
            <TokenIcon symbol={symbol} size={104} />
            <div className="mt-5 font-mono text-[30px] font-semibold leading-none text-white">{symbol}</div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8A8A8A]">
              Cycle #{latestDecision?.cycle_number ?? "N/A"}
              {factors.length > 0 ? (
                <>
                  {" · "}
                  <span className={passedCount > 0 ? "text-[#00FF66]" : "text-[#8A8A8A]"}>{passedCount}</span>
                  <span className="text-[#3A3A3A]">/</span>
                  {factors.length}
                </>
              ) : null}
            </div>
          </div>

          {/* Row 2: factors, fit below */}
          <div className="mt-8 min-h-0 flex-1">
            {factors.length > 0 ? (
              <StaticFactorList factors={factors} />
            ) : (
              <p className="py-3 text-center font-mono text-[12px] leading-5 text-[#8A8A8A]">
                {latestDecision?.reason?.trim()
                  ? latestDecision.reason
                  : "Signal audit will appear after the agent completes a scan cycle."}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-mono text-[12px] leading-5 text-[#8A8A8A]">Waiting for the next decision row…</p>
        </div>
      )}
    </div>
  );
}

/** Static (non-animated) pass/fail factor list. */
function StaticFactorList({ factors }: { factors: ScanFactor[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-10 gap-y-1.5">
      {factors.map((factor) => {
        const tone = factor.passed ? "text-[#00FF66]" : "text-[#FF6B6B]";
        return (
          <li key={factor.key} className="rounded-sm px-2 py-1.5 font-mono text-[13px]">
            <div className="flex items-center gap-3">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <span className={cx("text-[13px] font-bold leading-none", tone)}>
                  {factor.passed ? "✓" : "✗"}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate uppercase tracking-[0.06em] text-[#C8C8C8]">
                {factor.label}
              </span>
              <span className={cx("shrink-0 text-[10px] uppercase tracking-[0.12em]", tone)}>
                {factor.passed ? "PASS" : "FAIL"}
              </span>
            </div>
            <div className="mt-1 pl-7">
              {factor.reading ? (
                <p
                  className={cx(
                    "text-[11px] leading-4 tabular-nums",
                    factor.passed ? "text-[#9AD3B0]" : "text-[#D89A9A]",
                  )}
                >
                  {factor.reading}
                </p>
              ) : null}
              <p className="text-[11px] leading-4 text-[#6A6A6A]">{explainFactor(factor.key, factor.passed)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityTabSelector({
  value,
  onChange,
  compact = false,
}: {
  value: ActivityView;
  onChange: (view: ActivityView) => void;
  compact?: boolean;
}) {
  const tabs: Array<{ id: ActivityView; label: string; compactLabel: string }> = [
    { id: "sys", label: "Sys Logs", compactLabel: "Logs" },
    { id: "txs", label: "Tx Activity", compactLabel: "Tx" },
  ];

  return (
    <ViewportReveal variant="fade" delay={90} duration="fast">
      <div className={cx("flex shrink-0 items-center", compact ? "gap-4" : "gap-2")}>
        {tabs.map((tab, index) => {
          const active = tab.id === value;

          return (
            <ViewportReveal
              key={tab.id}
              variant={tab.id === "txs" ? "right" : "left"}
              delay={120 + index * 50}
              duration="fast"
            >
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                aria-pressed={active}
                className={cx(
                  "relative font-mono transition-colors",
                  compact
                    ? cx(
                        "px-0 py-1 text-[11px] uppercase tracking-[0.1em]",
                        active ? "font-semibold text-white" : "font-medium text-[#666666] active:text-[#999999]",
                      )
                    : cx(
                        "border h-9 px-4 text-xs",
                        active
                          ? "border-[#666666] bg-[#222222] text-white"
                          : "border-[#242424] bg-[#101010] text-[#A8A8A8] hover:border-[#3A3A3A] hover:text-white",
                      ),
                )}
              >
                {compact ? tab.compactLabel : tab.label}
                {compact && active ? (
                  <span className="absolute -bottom-3 left-0 right-0 h-px bg-white" aria-hidden="true" />
                ) : null}
              </button>
            </ViewportReveal>
          );
        })}
      </div>
    </ViewportReveal>
  );
}

function ActivityViewTransition({
  view,
  className,
  children,
}: {
  view: ActivityView;
  className?: string;
  children: (activeView: ActivityView) => ReactNode;
}) {
  const [displayedView, setDisplayedView] = useState(view);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const [direction, setDirection] = useState<"to-txs" | "to-sys">("to-sys");
  const enterIdleTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (view === displayedView) {
      return;
    }

    setDirection(view === "txs" ? "to-txs" : "to-sys");
    setPhase("out");

    const swapTimeout = window.setTimeout(() => {
      setDisplayedView(view);
      setPhase("in");

      enterIdleTimeoutRef.current = window.setTimeout(() => {
        setPhase("idle");
      }, 380);
    }, 180);

    return () => {
      window.clearTimeout(swapTimeout);
      if (enterIdleTimeoutRef.current !== undefined) {
        window.clearTimeout(enterIdleTimeoutRef.current);
        enterIdleTimeoutRef.current = undefined;
      }
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [view, displayedView]);

  const motionClass =
    phase === "out"
      ? direction === "to-txs"
        ? "activity-view-out-sys"
        : "activity-view-out-txs"
      : phase === "in"
        ? direction === "to-txs"
          ? "activity-view-in-txs"
          : "activity-view-in-sys"
        : null;

  return (
    <div className={className}>
      <div key={displayedView} className={cx("flex min-h-0 flex-1 flex-col", motionClass)}>
        {children(displayedView)}
      </div>
    </div>
  );
}

function SysLogsPanel({
  rows,
  agentLog,
  agentRunning,
  compact = false,
  feedOnly = false,
  mobileSplit = false,
  mobileNarrative = false,
  fillHeight = false,
  readable = false,
  rowsPerPage = ACTIVITY_ROWS_PER_PAGE,
}: {
  rows: ActivityRow[];
  agentLog: ReturnType<typeof resolveAgentLogLine>;
  latestDecision?: StatusPayload["latestDecision"];
  agentRunning: boolean;
  compact?: boolean;
  feedOnly?: boolean;
  mobileSplit?: boolean;
  mobileNarrative?: boolean;
  fillHeight?: boolean;
  readable?: boolean;
  rowsPerPage?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <div className={cx(compact && "flex h-full min-h-0 flex-col", fillHeight && "overflow-hidden")}>
      {!feedOnly && agentLog.line ? (
        <ViewportReveal variant="blur" duration="slow" className={cx(compact ? "mb-4 shrink-0" : "mb-6")}>
          <div
            className={cx(
              compact ? "border-b border-[#1A1A1A] pb-4" : "border border-[#2A2A2A] bg-black/88 px-5 py-4",
            )}
          >
            <ViewportReveal variant="fade" delay={60} duration="fast">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">
                Latest bot log{agentLog.source ? ` (${agentLog.source})` : ""}
              </div>
            </ViewportReveal>
            <ViewportReveal variant="left" delay={120}>
              <p className={cx("break-words font-mono leading-5 text-[#DADADA]", readable ? "text-[13px]" : "text-[12px]")}>
                {agentLog.line}
              </p>
            </ViewportReveal>
            <ViewportReveal variant="scale" delay={180} duration="fast" className="mt-3">
              <StatusBadge status={agentRunning ? "RUNNING" : "OFFLINE"} tone={agentRunning ? "green" : "red"} />
            </ViewportReveal>
          </div>
        </ViewportReveal>
      ) : null}

      {compact ? (
        mobileNarrative ? (
          <MobileLogFeed
            rows={rows}
            scrollRoot={scrollRoot}
            scrollContainerRef={scrollRef}
            rowsPerPage={rowsPerPage}
          />
        ) : (
          <RecentActivity
            rows={rows}
            expandable
            compact
            dense={mobileSplit}
            mode="logs"
            scrollRoot={scrollRoot}
            scrollContainerRef={scrollRef}
            className={cx("min-h-0 flex-1", fillHeight && "h-full")}
            readable={readable}
            rowsPerPage={rowsPerPage}
          />
        )
      ) : (
        <ViewportReveal variant="fade" delay={80}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div className="border-b border-[#1A1A1A] px-5 py-5">
              <ViewportReveal variant="left" delay={120} duration="fast">
                <h2 className="font-mono text-xl text-[#DADADA]">Decision &amp; Execution Log</h2>
              </ViewportReveal>
            </div>
            <RecentActivity
              rows={rows}
              expandable
              mode="logs"
              scrollRoot={scrollRoot}
              scrollContainerRef={scrollRef}
            />
          </div>
        </ViewportReveal>
      )}
    </div>
  );
}

function TxActivityPanel({
  rows,
  compact = false,
  mobileSplit = false,
  fillHeight = false,
  readable = false,
  rowsPerPage = ACTIVITY_ROWS_PER_PAGE,
}: {
  rows: ActivityRow[];
  compact?: boolean;
  mobileSplit?: boolean;
  fillHeight?: boolean;
  readable?: boolean;
  rowsPerPage?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <div className={cx("flex min-h-0 flex-col", fillHeight ? "h-full overflow-hidden" : "flex-1", !compact && "gap-0")}>
      {!compact ? (
        <ViewportReveal variant="right" delay={60} duration="fast" className="mb-6 max-w-3xl">
          <p className="font-mono text-[12px] leading-5 text-[#8A8A8A]">
            On-chain swaps and execution events from TWAK portfolio telemetry.
          </p>
        </ViewportReveal>
      ) : null}

      {compact ? (
        <RecentActivity
          rows={rows}
          expandable
          compact
          dense={mobileSplit}
          mode="txs"
          scrollRoot={scrollRoot}
          scrollContainerRef={scrollRef}
          className={cx("min-h-0 flex-1", fillHeight && "h-full")}
          readable={readable}
          rowsPerPage={rowsPerPage}
        />
      ) : (
        <ViewportReveal variant="fade" delay={100}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div className="border-b border-[#1A1A1A] px-5 py-5">
              <ViewportReveal variant="right" delay={140} duration="fast">
                <h2 className="font-mono text-xl text-[#DADADA]">Recent Activity</h2>
              </ViewportReveal>
            </div>
            <RecentActivity
              rows={rows}
              expandable
              mode="txs"
              scrollRoot={scrollRoot}
              scrollContainerRef={scrollRef}
            />
          </div>
        </ViewportReveal>
      )}
    </div>
  );
}

function useLiveClock(intervalMs: number): Date | null {
  const store = useMemo(() => createClockStore(intervalMs), [intervalMs]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

function LiveClock({ className }: { className?: string }) {
  // Live UTC digital clock. Starts null on the server to avoid an SSR
  // hydration mismatch, then ticks once a second on the client.
  const now = useLiveClock(1000);
  const time = now ? now.toISOString().slice(11, 19) : "--:--:--";
  return (
    <div className={cx("flex items-baseline gap-2", className)}>
      <span className="font-mono text-[34px] font-semibold leading-none tracking-[0.10em] tabular-nums text-white">
        {time}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">UTC</span>
    </div>
  );
}

function ActivityPanel({
  activityRows,
  logRows,
  agentLog,
  latestDecision,
  decisions,
  agentRunning,
  compact = false,
  desktop = false,
}: {
  activityRows: ActivityRow[];
  logRows: ActivityRow[];
  agentLog: ReturnType<typeof resolveAgentLogLine>;
  latestDecision: StatusPayload["latestDecision"];
  decisions: StatusPayload["decisions"];
  agentRunning: boolean;
  compact?: boolean;
  desktop?: boolean;
}) {
  const [view, setView] = useState<ActivityView>("sys");
  const [pane, setPane] = useState<"live" | "past">("live");
  const flat = panelUsesFlatChrome(compact, desktop);

  if (desktop) {
    return (
      <section className="flex min-h-0 flex-1 flex-col px-8 pt-6">
        <div className="shrink-0 border-b border-[#1A1A1A] pb-4">
          <LiveClock className="mb-3" />
          <ViewportReveal variant="blur" duration="slow" className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Telemetry</div>
            <h1 className="mt-2 font-mono text-[28px] font-semibold leading-tight text-white">Activity</h1>
          </ViewportReveal>
        </div>

        {pane === "live" ? (
          <div className="flex min-h-0 flex-1 flex-col pt-10 pb-6">
            <ViewportReveal variant="fade" delay={80} className="flex min-h-0 flex-1 flex-col">
              <SimpleLiveScan latestDecision={latestDecision} onViewPast={() => setPane("past")} />
            </ViewportReveal>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col pt-5 pb-6">
            <ViewportReveal variant="fade" delay={80} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col border border-[#2A2A2A] bg-black/88">
                <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#1A1A1A] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setPane("live")}
                      className="group inline-flex items-center gap-2 border border-[#2A2A2A] bg-black/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9A9A9A] transition-colors hover:border-[#3F3F3F] hover:text-white"
                    >
                      <span aria-hidden="true" className="text-[#666666] transition-colors group-hover:text-[#FFD21A]">
                        ←
                      </span>
                      Live
                    </button>
                    <h2 className="truncate font-mono text-[14px] uppercase tracking-[0.1em] text-[#DADADA]">
                      {view === "txs" ? "Tx Activity" : "Decision & Execution Log"}
                    </h2>
                  </div>
                  <ActivityTabSelector value={view} onChange={setView} compact />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
                  <ActivityViewTransition view={view} className="flex h-full min-h-0 flex-col">
                    {(activeView) =>
                      activeView === "txs" ? (
                        <TxActivityPanel rows={activityRows} compact readable fillHeight />
                      ) : (
                        <SysLogsPanel
                          rows={logRows}
                          agentLog={agentLog}
                          latestDecision={latestDecision}
                          agentRunning={agentRunning}
                          compact
                          readable
                          fillHeight
                        />
                      )
                    }
                  </ActivityViewTransition>
                </div>
              </div>
            </ViewportReveal>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className={cx(
        "flex min-h-0 flex-col overflow-hidden",
        compact && "flex-1",
        desktop && "flex-1 px-8 pt-6",
        !flat && "px-10 py-9",
      )}
    >
      {!compact ? (
        <div
          className={cx(
            "flex shrink-0 justify-between gap-4",
            flat ? "items-end border-b border-[#1A1A1A] pb-3" : "mb-6 items-start",
          )}
        >
          <ViewportReveal variant="blur" duration="slow" className="min-w-0">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Telemetry</div>
              <h1
                className={cx(
                  "mt-2 font-mono font-semibold leading-tight text-white",
                  flat ? "text-[28px]" : "text-[32px]",
                )}
              >
                Activity
              </h1>
            </div>
          </ViewportReveal>
          <ActivityTabSelector value={view} onChange={setView} compact={flat} />
        </div>
      ) : null}

      {compact ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden border-y border-[#2A2A2A] bg-black/58 shadow-[0_0_28px_rgba(0,0,0,0.45)]">
            <div className="relative z-[1] shrink-0">
              <LiveScanPanel
                latestDecision={latestDecision}
                decisions={decisions}
                agentRunning={agentRunning}
                mobileFit
                mobileTabs={<ActivityTabSelector value={view} onChange={setView} compact />}
              />
            </div>
            <div className="relative z-[1] min-h-0 flex-1 basis-0 overflow-hidden">
              <ActivityViewTransition view={view} className="flex h-full min-h-0 flex-col">
                {(activeView) =>
                  activeView === "txs" ? (
                    <TxActivityPanel
                      rows={activityRows}
                      compact
                      fillHeight
                      rowsPerPage={ACTIVITY_ROWS_PER_PAGE_MOBILE}
                    />
                  ) : (
                    <SysLogsPanel
                      rows={logRows}
                      agentLog={agentLog}
                      agentRunning={agentRunning}
                      compact
                      feedOnly
                      mobileNarrative
                      fillHeight
                      rowsPerPage={ACTIVITY_LOG_ROWS_PER_PAGE_MOBILE}
                    />
                  )
                }
              </ActivityViewTransition>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 shrink-0">
            <ViewportReveal variant="fade" delay={120}>
              <LiveScanPanel
                latestDecision={latestDecision}
                decisions={decisions}
                agentRunning={agentRunning}
              />
            </ViewportReveal>
          </div>

          <ViewportReveal variant="expand" delay={160} duration="slow" className="mb-4 h-px bg-[#1A1A1A]" />

          <ActivityViewTransition view={view} className="flex min-h-0 flex-1 flex-col">
            {(activeView) =>
              activeView === "txs" ? (
                <TxActivityPanel rows={activityRows} compact={flat} />
              ) : (
                <SysLogsPanel
                  rows={logRows}
                  agentLog={agentLog}
                  agentRunning={agentRunning}
                  compact={flat}
                />
              )
            }
          </ActivityViewTransition>
        </>
      )}
    </section>
  );
}

function DesktopDashboard({
  view,
  activeSection,
  onNavigate,
  data,
  timeRange,
  onTimeRangeChange,
  sectionTransitionEnabled,
}: {
  view: DashboardViewModel;
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
  data: StatusPayload | null;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  sectionTransitionEnabled: boolean;
}) {
  return (
    <div className="relative isolate hidden min-h-dvh flex-1 bg-black text-white lg:flex">
      <AsciiRaccoonWatermark glitch={activeSection === "market-chat"} />
      <DesktopNavRail activeSection={activeSection} onNavigate={onNavigate} />
      <main className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black">
        {view.telemetryError ? <TelemetryBanner message={view.telemetryError} /> : null}
        <SectionTransition
          section={activeSection}
          enabled={sectionTransitionEnabled}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {(section) =>
            section === "activity" ? (
              <ActivityPanel
                activityRows={view.activityRows}
                logRows={view.logRows}
                agentLog={resolveAgentLogLine(data)}
                latestDecision={data?.latestDecision ?? null}
                decisions={data?.decisions ?? []}
                agentRunning={Boolean(data?.health.agentRunning)}
                desktop
              />
            ) : section === "wallet" ? (
              <WalletPanel balances={view.walletBalances} agentMode={view.agentMode} desktop />
            ) : section === "x402" ? (
              <X402PaymentsPanel
                records={view.x402Records}
                marketData={view.x402MarketData}
                marketDataErrors={view.x402MarketDataErrors}
                instrumented={view.x402Instrumented}
                paidCallCount={view.x402PaidCallCount}
                dailySpendUsdc={view.x402DailySpendUsdc}
                totalSpendUsdc={view.x402TotalSpendUsdc}
                dailyBudgetUsdc={view.x402DailyBudgetUsdc}
                totalBudgetUsdc={view.x402TotalBudgetUsdc}
                desktop
              />
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
                executions={data?.executions ?? []}
                walletAddress={data?.wallet.address ?? null}
                decisions={data?.decisions ?? []}
                data={data}
                desktop
              />
            ) : section === "algorithm" ? (
              <DecisionAlgorithmPanel latestDecision={data?.latestDecision ?? null} desktop />
            ) : section === "market-chat" ? (
              <MarketChatPanel data={data} desktop />
            ) : (
              <DesktopOverviewSection view={view} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            )
          }
        </SectionTransition>
      </main>
    </div>
  );
}

const HOME_SUMMARY_ROW_LIMIT = 5;
const HOME_SUMMARY_MOBILE_ROW_LIMIT = 7;
const homeActivityGridClass = "grid grid-cols-3";

function HomePositionsSummary({
  positionRows,
  totalPositionValue,
  compact = false,
  flush = false,
}: {
  positionRows: PositionRow[];
  totalPositionValue: string;
  compact?: boolean;
  flush?: boolean;
}) {
  const rowLimit = compact ? HOME_SUMMARY_MOBILE_ROW_LIMIT : HOME_SUMMARY_ROW_LIMIT;
  const rows = [...positionRows]
    .sort((left, right) => (right.entryValueUsd ?? 0) - (left.entryValueUsd ?? 0))
    .slice(0, rowLimit);

  return (
    <div
      className={cx(
        "flex h-full min-h-0 flex-col overflow-hidden",
        compact ? "bg-black/30" : flush ? "bg-black/80" : "border border-[#1E1E1E] bg-black/80",
      )}
    >
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          className={cx(
            "border-b border-[#141416] font-mono uppercase tracking-[0.12em] text-[#757575]",
            compact
              ? "grid grid-cols-[1fr_auto] px-3 py-1.5 text-[9px]"
              : "grid grid-cols-[1.5fr_1fr_1fr] px-4 py-2 text-[10px]",
          )}
        >
          <span>Token</span>
          <span className="text-right">Value</span>
          {!compact ? <span className="text-right">Stop</span> : null}
        </div>
        {rows.length === 0 ? (
          <div className={cx("font-mono text-[#666666]", compact ? "px-3 py-3 text-[11px]" : "px-4 py-4 text-[13px]")}>
            No open positions in positions.json
          </div>
        ) : (
          <div className="divide-y divide-[#141416]">
            {rows.map((row) => (
              <div
                key={row.id}
                className={cx(
                  compact
                    ? "grid grid-cols-[1fr_auto] px-3 py-1.5 hover:bg-[#070707]"
                    : "grid grid-cols-[1.5fr_1fr_1fr] px-4 py-2 hover:bg-[#070707]",
                )}
              >
                <span className={cx("truncate font-mono text-[#D0D0D0]", compact ? "text-[11px]" : "text-[13px]")}>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <TokenIcon symbol={row.symbol} size={compact ? 12 : 14} />
                    <span className="truncate">{row.symbol}</span>
                  </span>
                </span>
                <span
                  className={cx(
                    "truncate text-right font-mono tabular-nums text-[#D0D0D0]",
                    compact ? "text-[11px]" : "text-[13px]",
                  )}
                >
                  {formatUsd(row.entryValueUsd)}
                </span>
                {!compact ? (
                  <span className="truncate text-right font-mono text-[13px] tabular-nums text-[#FFD21A]">
                    {formatPrice(row.trailingStopPrice)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className={cx(
          "shrink-0 border-t border-[#141416] font-mono uppercase tracking-[0.12em] text-[#666666]",
          compact ? "px-3 py-1 text-[10px]" : "px-4 py-2 text-[10px]",
        )}
      >
        {positionRows.length} total {positionRows.length === 1 ? "position" : "positions"}
      </div>
    </div>
  );
}

function homeActivityToken(row: ActivityRow): string | null {
  return row.token ?? tokenFromAmountLabel(row.amount);
}

function homeActivityScore(row: ActivityRow): string {
  const scoreMatch = row.amount.match(/score\s+(\d+\s*\/\s*\d+)/i);
  if (scoreMatch?.[1]) {
    return scoreMatch[1].replace(/\s+/g, "");
  }

  const numericScore = row.details?.items.find((item) => /score/i.test(item.label) && item.value !== "N/A")?.value;
  if (numericScore) {
    return numericScore;
  }

  return "N/A";
}

function HomeSignalSummary({
  latestDecision,
}: {
  latestDecision: StatusPayload["latestDecision"] | null;
}) {
  const symbol = latestDecision?.symbol ?? null;
  const analysis = latestDecision ? detailsFromDecision(latestDecision) : null;
  const factors = analysis?.factors ?? [];
  // Always show exactly 6 slots
  const slots = Array.from({ length: 6 }, (_, i) => factors[i] ?? null);
  const action = latestDecision?.action?.toUpperCase() ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black/30">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#141416] px-3 py-2">
        <span className="font-mono text-[11px] font-semibold leading-none text-white">Signal</span>
        {action ? (
          <span
            className={cx(
              "font-mono text-[8px] uppercase tracking-[0.1em] leading-none",
              action === "ENTER" ? "text-[#D0D0D0]" : "text-[#FF6B6B]",
            )}
          >
            {action}
          </span>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-3">
        {symbol ? (
          <div className="flex flex-col items-center justify-center gap-1">
            <TokenIcon symbol={symbol} size={52} />
            <span className="font-mono text-[12px] font-bold leading-none text-white">{symbol}</span>
          </div>
        ) : (
          <span className="font-mono text-[10px] text-[#555555]">No signal</span>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-around px-3 pb-4">
        {slots.map((factor, i) => {
          if (!factor) {
            return (
              <span
                key={i}
                className="h-[9px] w-[9px] shrink-0 rounded-full border border-[#5A5A5A] bg-[#202020]"
                aria-hidden="true"
              />
            );
          }
          return (
            <span
              key={factor.key}
              title={factor.label}
              aria-label={`${factor.label}: ${factor.passed ? "pass" : "fail"}`}
              className={cx(
                "h-[9px] w-[9px] shrink-0 rounded-full",
                factor.passed ? "bg-[#C8C8C8]" : "bg-[#FF4444]/60",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

function HomeActivitySummary({
  activityRows,
  logRows = [],
  compact = false,
  maxRows,
  flush = false,
}: {
  activityRows: ActivityRow[];
  logRows?: ActivityRow[];
  compact?: boolean;
  maxRows?: number;
  flush?: boolean;
}) {
  const [view, setView] = useState<ActivityView>("sys");
  const rowLimit = maxRows ?? (compact ? HOME_SUMMARY_MOBILE_ROW_LIMIT : HOME_SUMMARY_ROW_LIMIT);
  const rows = (view === "sys" ? logRows : activityRows).slice(0, rowLimit);

  return (
    <div
      className={cx(
        "flex h-full min-h-0 flex-col overflow-hidden",
        compact ? "bg-black/30" : flush ? "bg-black/80" : "border border-[#1E1E1E] bg-black/80",
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-center justify-between border-b border-[#141416]",
          compact ? "px-2 py-2" : "px-4 pb-3 pt-4",
        )}
      >
        {compact ? (
          <>
            <span className="font-mono text-xs font-medium uppercase tracking-widest leading-none text-[#666666]">Activity</span>
            <div className="flex items-center overflow-hidden rounded border border-[#333333]">
              {(["sys", "txs"] as ActivityView[]).map((tab) => {
                const active = tab === view;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setView(tab)}
                    aria-pressed={active}
                    style={{ fontSize: "9px", padding: "2px 5px", lineHeight: 1 }}
                    className={cx(
                      "font-mono uppercase tracking-wider transition-colors",
                      active ? "bg-[#333333] text-white font-semibold" : "text-[#555555] hover:text-[#999999]",
                    )}
                  >
                    {tab === "sys" ? "Log" : "Tx"}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy</div>
              <h2 className="mt-1 font-mono text-[16px] font-semibold text-white">Recent Activity</h2>
            </div>
            <div className="flex items-center gap-3">
              {(["sys", "txs"] as ActivityView[]).map((tab) => {
                const active = tab === view;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setView(tab)}
                    aria-pressed={active}
                    className={cx(
                      "font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                      active ? "font-semibold text-white" : "font-medium text-[#555555] hover:text-[#999999]",
                    )}
                  >
                    {tab === "sys" ? "Logs" : "Tx"}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto">
        {!compact ? (
          <div className={cx(homeActivityGridClass, "border-b border-[#141416] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#757575]")}>
            <span className="text-left">Date</span>
            <span className="text-center">Token</span>
            <span className="text-center">Status</span>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className={cx("font-mono text-[#666666]", compact ? "px-2 py-2 text-[10px]" : "px-4 py-4 text-[13px]")}>
            No recent activity
          </div>
        ) : (
          <div className={cx("divide-y divide-[#141416]", compact && "flex h-full flex-col")}>
            {rows.map((row) => {
              const token = homeActivityToken(row);

              if (compact) {
                const score = homeActivityScore(row);

                return (
                  <div
                    key={row.id}
                    className="grid min-h-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1 hover:bg-[#070707]"
                  >
                    <span className="flex items-center justify-start">
                      {token && row.explorerUrl ? (
                        <a
                          href={row.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex"
                          title={token}
                          aria-label={token}
                        >
                          <TokenIcon symbol={token} size={16} />
                        </a>
                      ) : token ? (
                        <span title={token} aria-label={token}>
                          <TokenIcon symbol={token} size={16} />
                        </span>
                      ) : (
                        <span className="h-4 w-4 rounded-full border border-[#2A2A2A]" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 truncate text-left font-mono text-[10px] font-bold tabular-nums text-[#F2F2F2]">
                      {score}
                    </span>
                    <span className="flex items-center justify-end">
                      <ActivityStatusIndicator status={row.status} tone={row.tone} compact />
                    </span>
                  </div>
                );
              }

              return (
                <div key={row.id} className={cx(homeActivityGridClass, "items-center px-4 py-2.5 hover:bg-[#070707]")}>
                  <span className="truncate text-left font-mono text-[13px] font-bold tabular-nums text-[#F2F2F2]">
                    {formatOpenedAt(row.timestamp)}
                  </span>
                  <span className="flex items-center justify-center">
                    {token ? (
                      <span title={token} aria-label={token}>
                        <TokenIcon symbol={token} size={18} />
                      </span>
                    ) : (
                      <span className="font-mono text-[13px] text-[#666666]">—</span>
                    )}
                  </span>
                  <span className="flex items-center justify-center">
                    <ActivityStatusIndicator status={row.status} tone={row.tone} compact />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!compact ? (
        <div className="shrink-0 border-t border-[#141416] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#666666]">
          {(view === "sys" ? logRows : activityRows).length} total events
        </div>
      ) : null}
    </div>
  );
}

function HomeWalletSummary({
  walletBalances,
  agentMode,
  compact = false,
  flush = false,
}: {
  walletBalances: WalletBalanceRow[];
  agentMode: string;
  compact?: boolean;
  flush?: boolean;
}) {
  const paperMode = agentMode === "PAPER";
  const rowLimit = compact ? HOME_SUMMARY_MOBILE_ROW_LIMIT : HOME_SUMMARY_ROW_LIMIT;
  const rows = [...walletBalances]
    .sort((left, right) => (right.valueUsd ?? 0) - (left.valueUsd ?? 0))
    .slice(0, rowLimit);

  return (
    <div
      className={cx(
        "flex h-full min-h-0 flex-col overflow-hidden",
        compact ? "bg-black/30" : flush ? "bg-black/80" : "border border-[#1E1E1E] bg-black/80",
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-baseline justify-between border-b border-[#141416]",
          compact ? "px-3 py-2" : "px-4 pb-3 pt-4",
        )}
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">TWAK Wallet</div>
          <h2 className={cx("font-mono font-semibold text-white", compact ? "text-[13px]" : "mt-1 text-[16px]")}>
            Live Holdings
          </h2>
        </div>
        {paperMode ? (
          <span
            className={cx(
              "border border-[#2A2A2A] font-mono uppercase tracking-[0.12em] text-[#757575]",
              compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
            )}
          >
            Paper mode
          </span>
        ) : null}
      </div>
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          className={cx(
            "grid border-b border-[#141416] font-mono uppercase tracking-[0.12em] text-[#757575]",
            compact
              ? "grid-cols-[auto_1fr_auto] px-3 py-1.5 text-[9px]"
              : "grid-cols-[1fr_1.5fr_1fr] px-4 py-2 text-[10px]",
          )}
        >
          <span>Chain</span>
          <span>Token</span>
          <span className="text-right">Value</span>
        </div>
        {rows.length === 0 ? (
          <div className={cx("font-mono text-[#666666]", compact ? "px-3 py-3 text-[11px]" : "px-4 py-4 text-[13px]")}>
            Waiting for TWAK wallet balances
          </div>
        ) : (
          <div className="divide-y divide-[#141416]">
            {rows.map((row) => (
              <div
                key={`${row.chain}-${row.symbol}`}
                className={cx(
                  "hover:bg-[#070707]",
                  compact
                    ? "grid grid-cols-[auto_1fr_auto] px-3 py-1.5"
                    : "grid grid-cols-[1fr_1.5fr_1fr] px-4 py-2",
                )}
              >
                <span
                  className={cx(
                    "truncate font-mono uppercase text-[#8A8A8A]",
                    compact ? "text-[11px]" : "text-[13px]",
                  )}
                >
                  {row.chain}
                </span>
                <span className={cx("truncate font-mono text-[#D0D0D0]", compact ? "text-[11px]" : "text-[13px]")}>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <TokenIcon symbol={row.symbol} size={compact ? 12 : 14} />
                    <span className="truncate">{row.symbol}</span>
                  </span>
                </span>
                <span
                  className={cx(
                    "truncate text-right font-mono tabular-nums text-[#D0D0D0]",
                    compact ? "text-[11px]" : "text-[13px]",
                  )}
                >
                  {formatUsd(row.valueUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className={cx(
          "shrink-0 border-t border-[#141416] font-mono uppercase tracking-[0.12em] text-[#666666]",
          compact ? "px-3 py-1 text-[10px]" : "px-4 py-2 text-[10px]",
        )}
      >
        {walletBalances.length} total {walletBalances.length === 1 ? "asset" : "assets"}
      </div>
    </div>
  );
}

function ChartModeToggle({
  experimental,
  onToggle,
}: {
  experimental: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={experimental}
      aria-label={experimental ? "Exit experimental chart mode" : "Enter experimental chart mode"}
      className={cx(
        "absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
        experimental
          ? "border-[#00FF66]/40 bg-[#001A0A]/90 text-[#00FF66] backdrop-blur-sm"
          : "border-[#242424] bg-[#101010]/90 text-[#A8A8A8] backdrop-blur-sm hover:text-white",
      )}
    >
      <span className="relative inline-flex h-3.5 w-6 items-center rounded-full bg-[#2A2A2A]">
        <span
          className={cx(
            "absolute h-2.5 w-2.5 rounded-full transition-transform",
            experimental ? "translate-x-3 bg-[#00FF66]" : "translate-x-0.5 bg-[#666666]",
          )}
        />
      </span>
      {experimental ? "Experimental" : "Standard"}
    </button>
  );
}

function DesktopOverviewSection({
  view,
  timeRange,
  onTimeRangeChange,
}: {
  view: DashboardViewModel;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  const [experimentalMode, setExperimentalMode] = useState(false);

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col pb-6 pr-8 pt-3">
        <div
          className={cx(
            "grid min-h-0 flex-1 gap-0 border border-[#1E1E1E] bg-black/80",
            experimentalMode ? "grid-cols-1 grid-rows-[minmax(0,1fr)]" : "grid-cols-3 grid-rows-[minmax(0,1fr)_300px]",
          )}
        >
          <ViewportReveal
            variant="fade"
            delay={200}
            duration="slow"
            className={cx(
              "relative h-full min-h-0 overflow-hidden",
              !experimentalMode && "col-span-3 border-b border-[#1E1E1E]",
            )}
          >
            <ChartModeToggle
              experimental={experimentalMode}
              onToggle={() => setExperimentalMode((v) => !v)}
            />
            {!experimentalMode && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
                <DesktopHeroMetrics view={view} />
              </div>
            )}
            <TimezoneMenu />
            <ChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            <div className="absolute inset-0">
              <PortfolioChart data={view.chartData} variant="desktop" range={timeRange} />
            </div>
          </ViewportReveal>

          {!experimentalMode && (
            <>
              <ViewportReveal
                variant="up"
                delay={400}
                duration="normal"
                className="flex h-full min-h-0 flex-col border-r border-[#1E1E1E]"
              >
                <HomePositionsSummary positionRows={view.positionRows} totalPositionValue={view.totalPositionValue} flush />
              </ViewportReveal>
              <ViewportReveal
                variant="up"
                delay={460}
                duration="normal"
                className="flex h-full min-h-0 flex-col border-r border-[#1E1E1E]"
              >
                <HomeActivitySummary activityRows={view.activityRows} logRows={view.logRows} flush />
              </ViewportReveal>
              <ViewportReveal variant="up" delay={520} duration="normal" className="flex h-full min-h-0 flex-col">
                <HomeWalletSummary walletBalances={view.walletBalances} agentMode={view.agentMode} flush />
              </ViewportReveal>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DesktopHeroMetrics({ view }: { view: DashboardViewModel }) {
  return (
    <section className="px-4 pt-3">
      <div className="grid grid-cols-4 divide-x divide-[#1A1A1A]">
        {view.metrics.map((metric, index) => (
          <ViewportReveal
            key={metric.label}
            variant={homeMetricVariant(metric.label, metric.tone)}
            delay={index * 60}
            duration={metric.label.includes("Balance") ? "slow" : "normal"}
            className="min-w-0 px-6 text-center first:pl-0 last:pr-0"
          >
            <div className="font-mono text-[7px] font-medium text-[#B8B8B8]">{metric.label}</div>
            <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5">
              <span className="font-mono text-[12px] font-bold leading-none text-white tabular-nums">{metric.value}</span>
              {metric.unit ? <span className="font-mono text-[7px] text-[#B8B8B8]">{metric.unit}</span> : null}
              {metric.delta ? (
                <span
                  className={cx(
                    "font-mono text-[7px] font-bold tabular-nums",
                    metric.tone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]",
                  )}
                >
                  ({metric.delta})
                </span>
              ) : null}
            </div>
          </ViewportReveal>
        ))}
      </div>
    </section>
  );
}

function OverviewTopBar({
  activeSection,
  enabled,
  fullWidth = false,
}: {
  activeSection: DashboardSection;
  enabled: boolean;
  fullWidth?: boolean;
}) {
  const isHome = activeSection === "overview";
  const [rendered, setRendered] = useState(isHome);
  const [phase, setPhase] = useState<"idle" | "in" | "out">(isHome ? "in" : "idle");
  const wasEnabledRef = useRef(false);
  const enterIdleTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!enabled) {
      setRendered(isHome);
      setPhase("idle");
      wasEnabledRef.current = false;
      return;
    }

    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      if (isHome) {
        setRendered(true);
        setPhase("in");

        const enterTimeout = window.setTimeout(() => {
          setPhase("idle");
        }, 380);

        return () => window.clearTimeout(enterTimeout);
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [enabled, isHome]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!enabled) {
      return;
    }

    if (isHome && !rendered) {
      setRendered(true);
      setPhase("in");

      enterIdleTimeoutRef.current = window.setTimeout(() => {
        setPhase("idle");
      }, 380);

      return () => {
        if (enterIdleTimeoutRef.current !== undefined) {
          window.clearTimeout(enterIdleTimeoutRef.current);
          enterIdleTimeoutRef.current = undefined;
        }
      };
    }

    if (!isHome && rendered) {
      setPhase("out");

      const exitTimeout = window.setTimeout(() => {
        setRendered(false);
        setPhase("idle");
      }, 220);

      return () => window.clearTimeout(exitTimeout);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isHome, rendered, enabled]);

  if (!rendered) {
    return null;
  }

  return (
    <header
      className={cx(
        "sticky top-0 z-30 shrink-0 border-b border-[#1A1A1A] bg-black/70 backdrop-blur-sm",
        enabled && phase === "in" && "home-topbar-in",
        enabled && phase === "out" && "home-topbar-out",
      )}
    >
      <a
        href={projectRepository.url}
        target="_blank"
        rel="noreferrer"
        className={cx(
          "flex items-center justify-between gap-3 py-2.5",
          fullWidth ? "px-8" : "w-full px-4",
        )}
        aria-label="Open No Named Yet Bot on GitHub"
      >
        <span className="min-w-0 truncate font-mono text-[11px] font-medium tracking-[0.06em] text-white">
          AlejoReyna/NoNamedYetBot
        </span>
        <Github size={14} strokeWidth={1.75} className="shrink-0 text-white" aria-hidden="true" />
      </a>
    </header>
  );
}

function MobileHeroMetrics({ view }: { view: DashboardViewModel }) {
  return (
    <section className="shrink-0 px-4 py-2">
      <div className="grid grid-cols-2 gap-x-4">
        <ViewportReveal variant="scale" duration="slow" className="min-w-0 text-center">
          <div className="font-mono text-[14px] font-medium text-[#B8B8B8]">Total Balance</div>
          <div className="mt-2 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
            <span className="font-mono text-[24px] font-bold leading-none text-white tabular-nums">{view.totalBalance}</span>
            <span className="font-mono text-[13px] text-[#B8B8B8]">USD</span>
          </div>
        </ViewportReveal>
        <ViewportReveal
          variant={homeMetricVariant("Window Profit/Loss", view.pnlTone)}
          delay={80}
          duration="slow"
          className="min-w-0 text-center"
        >
          <div className="font-mono text-[14px] font-medium text-[#B8B8B8]">Window Profit/Loss</div>
          <div className="mt-2 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
            <span className="font-mono text-[24px] font-bold leading-none text-white tabular-nums">{view.pnlValue}</span>
            {view.pnlDelta ? (
              <span
                className={cx(
                  "font-mono text-[14px] font-bold tabular-nums",
                  view.pnlTone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]",
                )}
              >
                ({view.pnlDelta})
              </span>
            ) : null}
          </div>
        </ViewportReveal>
      </div>
      <ViewportReveal variant="expand" delay={160} duration="slow" className="mt-2 h-px w-full bg-[#1A1A1A]" />
    </section>
  );
}

function ChartFilterMenu({
  timeRange,
  onTimeRangeChange,
}: {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="absolute right-3 top-3 z-10">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Chart time range: ${timeRange}`}
        className={cx(
          "inline-flex h-8 w-8 items-center justify-center border transition-colors",
          open
            ? "border-[#666666] bg-[#222222] text-white"
            : "border-[#242424] bg-[#101010]/90 text-[#A8A8A8] backdrop-blur-sm",
        )}
      >
        <Filter className="h-4 w-4" strokeWidth={2} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Chart time range"
          className="absolute right-0 top-[calc(100%+6px)] flex min-w-[88px] flex-col border border-[#242424] bg-[#050505] shadow-[0_12px_32px_rgba(0,0,0,0.72)]"
        >
          {timeRanges.map((range) => (
            <button
              key={range}
              type="button"
              role="option"
              aria-selected={range === timeRange}
              onClick={() => {
                onTimeRangeChange(range);
                setOpen(false);
              }}
              className={cx(
                "border-b border-[#1A1A1A] px-3 py-2 text-left font-mono text-[11px] last:border-b-0",
                range === timeRange
                  ? "bg-[#222222] text-white"
                  : "text-[#A8A8A8] hover:bg-[#101010] hover:text-white",
              )}
            >
              {range}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimezoneMenu() {
  const { timeZone, setTimeZone } = useChartTimeZone();
  const [open, setOpen] = useState(false);
  // Snapshotted whenever the menu opens so offsets/clocks are current.
  const [now, setNow] = useState(() => new Date());
  const rootRef = useRef<HTMLDivElement>(null);

  const toggle = () =>
    setOpen((previous) => {
      const next = !previous;
      if (next) {
        setNow(new Date());
      }
      return next;
    });

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="absolute right-[52px] top-3 z-10">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select chart time zone"
        className={cx(
          "inline-flex h-8 items-center gap-1.5 border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
          open
            ? "border-[#666666] bg-[#222222] text-white"
            : "border-[#242424] bg-[#101010]/90 text-[#A8A8A8] backdrop-blur-sm hover:text-white",
        )}
      >
        <Globe className="h-4 w-4" strokeWidth={2} />
        <span className="hidden sm:inline">{gmtOffsetLabel(timeZone, now)}</span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Chart time zone"
          className="absolute right-0 top-[calc(100%+6px)] flex max-h-[320px] w-[256px] flex-col overflow-y-auto border border-[#242424] bg-[#050505] shadow-[0_12px_32px_rgba(0,0,0,0.72)]"
        >
          <div className="sticky top-0 border-b border-[#1A1A1A] bg-[#050505] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#666666]">
            Time zone
          </div>
          {CHART_TIME_ZONES.map((zone) => {
            const selected = zone.id === timeZone;
            return (
              <button
                key={zone.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setTimeZone(zone.id);
                  setOpen(false);
                }}
                className={cx(
                  "flex items-center justify-between gap-3 border-b border-[#1A1A1A] px-3 py-2 text-left last:border-b-0",
                  selected ? "bg-[#161616]" : "hover:bg-[#101010]",
                )}
              >
                <span className="min-w-0">
                  <span className={cx("block truncate font-mono text-[12px]", selected ? "text-white" : "text-[#D4D4D4]")}>
                    {zone.label}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-[#6E6E6E]">{zone.cities}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[12px] tabular-nums text-[#A8A8A8]">{localTimeLabel(zone.id, now)}</span>
                  <span className="block font-mono text-[10px] text-[#6E6E6E]">{gmtOffsetLabel(zone.id, now)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MobileOverviewSection({
  view,
  timeRange,
  onTimeRangeChange,
  latestDecision = null,
}: {
  view: DashboardViewModel;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  latestDecision?: StatusPayload["latestDecision"] | null;
}) {
  const [experimentalMode, setExperimentalMode] = useState(false);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ViewportReveal
        variant="fade"
        delay={120}
        duration="normal"
        className={cx(
          "relative min-h-0 flex-1 bg-black/30",
          !experimentalMode && "border-b border-[#2A2A2A]",
        )}
      >
        <div className="absolute inset-0 flex flex-col">
          {!experimentalMode && (
            <div className="grid grid-cols-2 gap-x-4 px-4 pt-3 pb-2">
              <ViewportReveal variant="scale" duration="slow" className="min-w-0 text-center">
                <div className="font-mono text-[11px] font-medium text-[#B8B8B8]">Total Balance</div>
                <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5">
                  <span className="font-mono text-[20px] font-bold leading-none text-white tabular-nums">{view.totalBalance}</span>
                  <span className="font-mono text-[11px] text-[#B8B8B8]">USD</span>
                </div>
              </ViewportReveal>
              <ViewportReveal
                variant={homeMetricVariant("Window Profit/Loss", view.pnlTone)}
                delay={80}
                duration="slow"
                className="min-w-0 text-center"
              >
                <div className="font-mono text-[11px] font-medium text-[#B8B8B8]">Window P/L</div>
                <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5">
                  <span className="font-mono text-[20px] font-bold leading-none text-white tabular-nums">{view.pnlValue}</span>
                  {view.pnlDelta ? (
                    <span
                      className={cx(
                        "font-mono text-[11px] font-bold tabular-nums",
                        view.pnlTone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]",
                      )}
                    >
                      ({view.pnlDelta})
                    </span>
                  ) : null}
                </div>
              </ViewportReveal>
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            <ChartModeToggle
              experimental={experimentalMode}
              onToggle={() => setExperimentalMode((v) => !v)}
            />
            <TimezoneMenu />
            <ChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            <div className={cx("absolute inset-0", !experimentalMode && "p-2")}>
              <PortfolioChart data={view.mobileChartData} variant="mobile" range={timeRange} />
            </div>
          </div>
        </div>
      </ViewportReveal>
      {!experimentalMode && (
        <ViewportReveal
          variant="up"
          delay={200}
          duration="normal"
          className="flex shrink-0 flex-col"
        >
          <div className="grid grid-cols-2" style={{ height: "30vh" }}>
            <div className="col-span-1 flex flex-col border-r border-[#2A2A2A]">
              <HomeSignalSummary latestDecision={latestDecision} />
            </div>
            <div className="col-span-1 flex flex-col">
              <HomeActivitySummary activityRows={view.activityRows} logRows={view.logRows} compact />
            </div>
          </div>
        </ViewportReveal>
      )}
    </section>
  );
}

function MobileNavItemButton({
  item,
  active,
  onNavigate,
  buttonRef,
}: {
  item: (typeof dashboardNavItems)[number];
  active: boolean;
  onNavigate: (section: DashboardSection) => void;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onNavigate(item.section)}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={cx(
        "relative flex h-full min-w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 px-0.5 py-1 transition-colors",
        active ? "text-white" : "text-[#7A7A7A] active:text-white",
      )}
    >
      {active ? (
        <span className="absolute top-0 h-0.5 w-4 rounded-full bg-white" aria-hidden="true" />
      ) : null}
      <Icon size={18} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
    </button>
  );
}

function MobileBottomNav({
  activeSection,
  onNavigate,
}: {
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
}) {
  const itemRefs = useRef<Partial<Record<DashboardSection, HTMLButtonElement | null>>>({});

  useEffect(() => {
    itemRefs.current[activeSection]?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeSection]);

  return (
    <nav
      className="relative z-40 h-[52px] shrink-0 border-t border-[#1A1A1A] bg-black/75 backdrop-blur-sm"
      aria-label="Mobile navigation"
    >
      <div
        className="flex h-full w-full items-center overflow-x-auto px-1 [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Dashboard sections"
      >
        {dashboardNavItems.map((item) => (
          <MobileNavItemButton
            key={item.section}
            item={item}
            active={item.section === activeSection}
            onNavigate={onNavigate}
            buttonRef={(node) => {
              itemRefs.current[item.section] = node;
            }}
          />
        ))}
      </div>
    </nav>
  );
}

function MobileDashboard({
  view,
  activeSection,
  onNavigate,
  data,
  timeRange,
  onTimeRangeChange,
  sectionTransitionEnabled,
}: {
  view: DashboardViewModel;
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
  data: StatusPayload | null;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  sectionTransitionEnabled: boolean;
}) {
  const showTopBar = activeSection !== "activity";
  const deviceTopSectionColor = deviceTopSectionColorFor(activeSection);

  return (
    <div className="relative isolate flex h-[100dvh] flex-col overflow-hidden bg-black text-white lg:hidden">
      <DeviceTopSection color={deviceTopSectionColor} />
      <AsciiRaccoonWatermark glitch={activeSection === "market-chat"} />
      {view.telemetryError ? <TelemetryBanner message={view.telemetryError} /> : null}
      <main className="technical-grid technical-grid--fine relative z-[1] flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {showTopBar ? (
          <div className="shrink-0">
            <OverviewTopBar activeSection={activeSection} enabled={sectionTransitionEnabled} />
          </div>
        ) : null}
        <SectionTransition
          section={activeSection}
          enabled={sectionTransitionEnabled}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {(section) =>
            section === "activity" ? (
              <ActivityPanel
                activityRows={view.activityRows}
                logRows={view.logRows}
                agentLog={resolveAgentLogLine(data)}
                latestDecision={data?.latestDecision ?? null}
                decisions={data?.decisions ?? []}
                agentRunning={Boolean(data?.health.agentRunning)}
                compact
              />
            ) : section === "wallet" ? (
              <WalletPanel balances={view.walletBalances} agentMode={view.agentMode} compact />
            ) : section === "x402" ? (
              <X402PaymentsPanel
                records={view.x402Records}
                marketData={view.x402MarketData}
                marketDataErrors={view.x402MarketDataErrors}
                instrumented={view.x402Instrumented}
                paidCallCount={view.x402PaidCallCount}
                dailySpendUsdc={view.x402DailySpendUsdc}
                totalSpendUsdc={view.x402TotalSpendUsdc}
                dailyBudgetUsdc={view.x402DailyBudgetUsdc}
                totalBudgetUsdc={view.x402TotalBudgetUsdc}
                compact
              />
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
                compact
                decisions={data?.decisions ?? []}
                data={data}
              />
            ) : section === "algorithm" ? (
              <DecisionAlgorithmPanel latestDecision={data?.latestDecision ?? null} compact />
            ) : section === "market-chat" ? (
              <MarketChatPanel data={data} compact />
            ) : (
              <MobileOverviewSection
                view={view}
                timeRange={timeRange}
                onTimeRangeChange={onTimeRangeChange}
                latestDecision={data?.latestDecision ?? null}
              />
            )
          }
        </SectionTransition>
      </main>
      <MobileBottomNav activeSection={activeSection} onNavigate={onNavigate} />
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [timeRange, setTimeRange] = useState<TimeRange>("1D");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const body = await response.json();
        const parsed = statusSchema.safeParse(body);

        if (!parsed.success) {
          throw new Error("Dashboard telemetry failed validation");
        }

        if (!active) {
          return;
        }

        setData(parsed.data);
        setError(parsed.data.connection?.error ?? (response.ok ? null : `HTTP ${response.status}`));
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    }

    load();
    const interval = window.setInterval(load, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const view = useMemo(() => buildViewModel(data, error, timeRange), [data, error, timeRange]);

  // Track the last position-based P&L% so it stays frozen after the position is sold.
  const frozenPnlStore = useMemo(() => createFrozenValueStore<number>(), []);
  const frozenPositionPnl = useSyncExternalStore(
    frozenPnlStore.subscribe,
    frozenPnlStore.getSnapshot,
    frozenPnlStore.getServerSnapshot,
  );
  const positionPnlPercent = activePositionPnlPercent(view.positionRows);
  useEffect(() => {
    frozenPnlStore.set(positionPnlPercent);
  }, [frozenPnlStore, positionPnlPercent]);
  const effectivePnlPercent = positionPnlPercent ?? frozenPositionPnl;
  const effectiveDelta =
    effectivePnlPercent !== null ? formatPercent(effectivePnlPercent) : undefined;
  const effectivePnlTone: "positive" | "negative" =
    effectivePnlPercent !== null
      ? effectivePnlPercent >= 0
        ? "positive"
        : "negative"
      : view.pnlTone;

  const effectiveView = useMemo(() => {
    const deltaChanged = effectiveDelta !== view.pnlDelta;
    const toneChanged = effectivePnlTone !== view.pnlTone;
    if (!deltaChanged && !toneChanged) return view;
    return {
      ...view,
      pnlDelta: effectiveDelta,
      pnlTone: effectivePnlTone,
      metrics: view.metrics.map((m) =>
        m.label === "Window Profit/Loss"
          ? { ...m, delta: effectiveDelta, tone: effectivePnlTone }
          : m,
      ),
    };
  }, [view, effectiveDelta, effectivePnlTone]);

  const isDesktop = useMediaQuery("(min-width: 1024px)");

  return (
    <ChartTimeZoneProvider>
      <div className="flex min-h-dvh flex-1 flex-col">
        <MobileDashboard
          view={effectiveView}
          activeSection={activeSection}
          onNavigate={setActiveSection}
          data={data}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          sectionTransitionEnabled={!isDesktop}
        />
        <DesktopDashboard
          view={effectiveView}
          activeSection={activeSection}
          onNavigate={setActiveSection}
          data={data}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          sectionTransitionEnabled={isDesktop}
        />
      </div>
    </ChartTimeZoneProvider>
  );
}
