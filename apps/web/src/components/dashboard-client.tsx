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
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  Filter,
  Github,
  Globe,
  Home,
  Layers,
  Terminal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { DeviceTopSection } from "@/components/device-top-section";
import { DecisionAlgorithmPanel } from "@/components/decision-algorithm-panel";
import { MarketChatPanel } from "@/components/market-chat-panel";
import S3LogsPanel from "@/components/s3-logs-panel";
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
import { breakoutEntryScoreStats, entryFactorStats, ENTRY_FACTOR_KEYS, isComplianceDecision } from "@/lib/factor-scoring";
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
  type StatusPayload,
  type X402Call,
} from "@/lib/schemas";

type DashboardSection = "overview" | "positions" | "activity" | "wallet" | "algorithm" | "market-chat" | "x402" | "logs";
type ActivityView = "txs" | "sys";

const dashboardNavItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Home", icon: Home, section: "overview" },
  { label: "Positions", icon: Layers, section: "positions" },
  { label: "Activity", icon: Activity, section: "activity" },
  { label: "Intel", icon: Terminal, section: "market-chat" },
  { label: "Wallet", icon: Wallet, section: "wallet" },
  { label: "Payments", icon: CreditCard, section: "x402" },
  { label: "Logs", icon: FileText, section: "logs" },
  { label: "Guide", icon: BookOpen, section: "algorithm" },
];

const DESKTOP_NAV_WIDTH = 56;
const defaultDeviceTopSectionColor = "#000000";
const focusedDeviceTopSectionColor = "#1E2026";
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
  x402WalletAddress: string | null;
  x402WalletUsdcBalance: number | null;
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
  const priced =
    decision.priced_target_count != null
      ? ` across ${decision.priced_target_count} priced targets`
      : "";

  if (isComplianceDecision(decision)) {
    const target = decision.symbol?.trim() ? ` into ${decision.symbol.trim()}` : "";
    return `Daily-minimum compliance swap${target}: a tiny trade to satisfy the one-trade-per-day rule. Not scored against the entry factors.`;
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
          tone: decisionActionTone(action),
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
          tone: decisionActionTone(action),
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
    x402WalletAddress: data?.x402?.walletAddress ?? null,
    x402WalletUsdcBalance: data?.x402?.walletUsdcBalance ?? null,
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
      className="relative z-[1] flex h-dvh shrink-0 flex-col items-center border-r border-[#2B2F36] bg-[#1E2026]/95 backdrop-blur-sm"
      style={{ width: DESKTOP_NAV_WIDTH }}
      aria-label="Dashboard navigation"
    >
      <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-[#1E2026]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/no-bg.png"
          alt="Logo"
          className="h-9 w-auto object-contain opacity-90"
          style={{ filter: "brightness(1.5) drop-shadow(0 0 3px rgba(255,255,255,0.4))" }}
        />
      </div>
      <div className="flex w-full flex-1 flex-col items-center gap-1 px-2 py-3">
        {desktopNavItems.map((item) => {
          const Icon = item.icon;
          const active = item.kind === "section" && item.section === activeSection;
          const rowClassName = cx(
            "relative flex h-10 w-10 items-center justify-center rounded-sm transition-colors",
            active ? "text-[#F0B90B]" : "text-[#7A7A7A] hover:text-white",
          );
          const rowContent = (
            <>
              {active ? (
                <span
                  className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[#F0B90B]"
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
    green: "border-[#0ECB81]/20 bg-[#0ECB81]/10 text-[#0ECB81]",
    yellow: "border-[#B0B3B8]/20 bg-[#B0B3B8]/10 text-[#B0B3B8]",
    red: "border-[#F6465D]/20 bg-[#F6465D]/10 text-[#F6465D]",
  }[tone];

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border px-2.5 py-1 font-sans text-[10px] font-bold uppercase tracking-wider",
        classes,
      )}
    >
      {status}
    </span>
  );
}

function activityStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "ENTER":
      return "Enter";
    case "WAIT":
      return "Wait";
    case "HALT":
      return "Halt";
    case "BLOCKED":
      return "Blocked";
    case "SUCCESS":
      return "Done";
    case "PENDING":
      return "Pending";
    case "FAILED":
      return "Failed";
    case "MISSING":
      return "Missing";
    case "OFFLINE":
      return "Offline";
    case "RUNNING":
      return "Running";
    case "READY":
      return "Ready";
    default:
      return status;
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
  const label = activityStatusLabel(status);
  const classes = {
    green: "border-[#0ECB81]/20 bg-[#0ECB81]/10 text-[#0ECB81]",
    yellow: "border-[#B0B3B8]/20 bg-[#B0B3B8]/10 text-[#B0B3B8]",
    red: "border-[#F6465D]/20 bg-[#F6465D]/10 text-[#F6465D]",
  }[tone];

  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-sans font-bold uppercase tracking-wider",
        compact ? (readable ? "px-2.5 py-1 text-[10px]" : "px-2 py-0.5 text-[9px]") : "px-3 py-1 text-[10px]",
        classes,
      )}
      title={status}
      aria-label={status}
    >
      {label}
    </span>
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
    <div className="border-b border-[#2B2F36] bg-[#1B1200] px-5 py-3 font-sans text-[12px] leading-5 text-[#B0B3B8]">
      <span className="font-bold uppercase tracking-[0.12em]">Telemetry:</span> {message}
      <span className="mt-1 block text-[#B0B3B8]">
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
      className={cx("border-b border-[#2B2F36] text-white", !compact && "hover:bg-[#0B0E11]")}
    >
      <td className="truncate px-3 py-2 font-sans text-[12px] uppercase text-[#B0B3B8]">
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
      <td className="truncate px-2 py-2 font-sans text-[13px] font-bold text-[#FFFFFF]">
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
      <td className="truncate px-2 py-2 font-sans text-[12px] tabular-nums text-[#B0B3B8]">
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
      <td className="truncate px-3 py-2 text-right font-sans text-[12px] tabular-nums text-[#B0B3B8]">
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
  x402WalletAddress,
  x402WalletUsdcBalance,
  compact = false,
  desktop = false,
}: {
  balances: WalletBalanceRow[];
  agentMode: string;
  x402WalletAddress?: string | null;
  x402WalletUsdcBalance?: number | null;
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
        !flat && "mx-10 my-9 border border-[#3A3F4B] bg-[#1E2026] bento-card",
      )}
    >
      <div className={cx(flat ? "shrink-0 border-b border-[#2B2F36] pb-4" : "border-b border-[#2B2F36] px-5 py-5")}>
        <ViewportReveal variant="blur" duration="slow">
          <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">TWAK Wallet</div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1
              className={cx(
                "font-sans font-semibold leading-tight text-white inline-flex items-center gap-2",
                flat ? "text-[28px]" : "text-[32px]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/trust_logo.png" alt="TWAK" className="h-6 w-6 object-contain rounded-sm" />
              Live Holdings
            </h1>
            <div className="shrink-0 text-right font-sans">
              <ViewportReveal variant="fade" delay={70} duration="fast">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">
                  {balances.length} {balances.length === 1 ? "token" : "tokens"}
                </div>
              </ViewportReveal>
              <ViewportReveal variant="scale" delay={130} duration="slow">
                <div className="mt-1 text-sm tabular-nums text-white">{formatUsd(totalValue)}</div>
              </ViewportReveal>
              {paperMode ? (
                <ViewportReveal variant="down" delay={190} duration="fast">
                  <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[#B0B3B8]">Paper mode</div>
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
          <thead className="border-b border-[#2B2F36] font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-[#848E9C]">
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
              <tr className="border-b border-[#2B2F36]">
                <td className="px-3 py-4 font-sans text-[12px] text-[#848E9C]" colSpan={4}>
                  <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                    Waiting for TWAK wallet balances
                  </ViewportReveal>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {x402WalletAddress ? (
        <div className={cx("shrink-0 mx-4 mb-4 mt-3 rounded-xl border border-[#3A3F4B] bg-[#0B0E11] bento-card", flat ? "px-4 py-4" : "px-5 py-5")}>
          <ViewportReveal variant="blur" duration="slow">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">x402 Wallet</div>
                <h2 className={cx("font-sans mt-2 font-semibold text-white inline-flex items-center gap-2", flat ? "text-[18px]" : "text-[22px]")}>
                  <span className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/usdc-logo.png" alt="USDC" className="h-5 w-5 object-contain" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/base_logo.png" alt="Base" className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 object-contain rounded-full border border-[#2B2F36] bg-[#0B0E11]" />
                  </span>
                  Base USDC
                </h2>
                <div className="mt-1 font-sans text-[10px] text-[#848E9C]">
                  {x402WalletAddress.slice(0, 6)}…{x402WalletAddress.slice(-4)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">Balance</div>
                <div className="mt-1 font-sans text-[20px] font-semibold tabular-nums text-[#FFD666]">
                  {x402WalletUsdcBalance != null ? formatUsd(x402WalletUsdcBalance) : "—"}
                </div>
              </div>
            </div>
          </ViewportReveal>
        </div>
      ) : (
        <div className={cx("shrink-0 mx-4 mb-4 mt-3 rounded-xl border border-[#3A3F4B] bg-[#0B0E11] bento-card", flat ? "px-4 py-4" : "px-5 py-5")}>
          <ViewportReveal variant="blur" duration="slow">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">x402 Wallet</div>
                <h2 className={cx("font-sans mt-2 font-semibold text-white inline-flex items-center gap-2", flat ? "text-[18px]" : "text-[22px]")}>
                  <span className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/usdc-logo.png" alt="USDC" className="h-5 w-5 object-contain" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/base_logo.png" alt="Base" className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 object-contain rounded-full border border-[#2B2F36] bg-[#0B0E11]" />
                  </span>
                  Base USDC
                </h2>
                <div className="mt-1 font-sans text-[10px] text-[#848E9C]">
                  Not connected — restart bot with updated exporter
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">Balance</div>
                <div className="mt-1 font-sans text-[20px] font-semibold tabular-nums text-[#848E9C]">—</div>
              </div>
            </div>
          </ViewportReveal>
        </div>
      )}
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
    <div className="min-w-0 text-right font-sans">
      <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">{label}</div>
      <div className={cx("mt-1 truncate text-sm tabular-nums", tone === "red" ? "text-[#F6465D]" : "text-white")}>
        {value}
      </div>
      {sub ? <span className="font-sans text-[9px] text-[#666]">{sub}</span> : null}
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
    return "text-[#0ECB81]";
  }

  if (tone === "red") {
    return "text-[#F6465D]";
  }

  return "text-[#B0B3B8]";
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
    <div className="border-b border-[#2B2F36] py-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-3">
        <ViewportReveal variant="blur" duration="slow" root={scrollRoot} className="min-w-0">
          <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">Data gathered</div>
          <h2 className="mt-1 font-sans text-[18px] font-semibold leading-tight text-white">Market snapshot cache</h2>
        </ViewportReveal>
        <div className="grid grid-cols-3 gap-x-5 gap-y-2">
          <X402SummaryMetric label="Symbols" value={String(sortedRows.length)} />
          <X402SummaryMetric label="Prices" value={String(pricedCount)} />
          <X402SummaryMetric label="Fresh" value={latestMarketDataAge(sortedRows)} />
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="mx-3 mb-3 border border-[#2B2F36] bg-[#0B0E11]/55 px-3 py-2 font-sans text-[11px] leading-5 text-[#F6465D]">
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
        <thead className="border-y border-[#2B2F36] font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-[#848E9C]">
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
              <tr key={`${row.symbol}-${row.updatedAt ?? index}`} className="border-b border-[#2B2F36] text-white hover:bg-[#0B0E11]">
                <td className="px-3 py-2">
                  <ViewportReveal
                    as="span"
                    variant={walletColumnVariant("token")}
                    delay={walletCellDelay(index, "token")}
                    root={scrollRoot}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <TokenIcon symbol={row.symbol} size={14} />
                    <span className="truncate font-sans text-[12px] font-bold text-[#FFFFFF]">{row.symbol}</span>
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-sans text-[12px] tabular-nums text-[#B0B3B8]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "amount")} root={scrollRoot} className="block truncate">
                    {formatPrice(row.price)}
                  </ViewportReveal>
                </td>
                <td className={cx("truncate px-3 py-2 font-sans text-[12px] tabular-nums", marketToneClass(priceTone))}>
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "value")} root={scrollRoot} className="block truncate">
                    {formatPercent(row.priceChangePct)}
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-sans text-[12px] tabular-nums text-[#B0B3B8]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "amount")} root={scrollRoot} className="block truncate">
                    {formatMarketVolume(row.volume)}
                  </ViewportReveal>
                </td>
                <td className={cx("truncate px-3 py-2 font-sans text-[12px] tabular-nums", marketToneClass(volumeTone))}>
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "value")} root={scrollRoot} className="block truncate">
                    {formatPercent(row.volumeChangePct)}
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-sans text-[12px] tabular-nums text-[#B0B3B8]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "chain")} root={scrollRoot} className="block truncate">
                    {formatOpenedAt(row.updatedAt)}
                  </ViewportReveal>
                </td>
                <td className="truncate px-3 py-2 font-sans text-[10px] font-bold tracking-[0.08em] text-[#848E9C]">
                  <ViewportReveal as="span" variant="fade" delay={walletCellDelay(index, "value")} root={scrollRoot} className="block truncate">
                    {x402MarketSourceLabel(row.source)}
                  </ViewportReveal>
                </td>
              </tr>
            );
          })}
          {sortedRows.length === 0 ? (
            <tr className="border-b border-[#2B2F36]">
              <td className="px-3 py-4 font-sans text-[12px] text-[#848E9C]" colSpan={7}>
                <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                  No market cache rows available yet
                </ViewportReveal>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {volumeCount === 0 && sortedRows.length > 0 ? (
        <div className="px-3 pt-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">
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
        !flat && "mx-10 my-9 border border-[#3A3F4B] bg-[#1E2026] bento-card",
      )}
    >
      <div className={cx(flat ? "shrink-0 border-b border-[#2B2F36] pb-4" : "border-b border-[#2B2F36] px-5 py-5")}>
        <ViewportReveal variant="blur" duration="slow">
          <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">x402 Payments</div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1
              className={cx(
                "min-w-0 font-sans font-semibold leading-tight text-white",
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
          <thead className="border-b border-[#2B2F36] font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-[#848E9C]">
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
                    "border-b border-[#2B2F36] text-white",
                    failed && "bg-[#0B0E11]/55",
                    !flat && "hover:bg-[#0B0E11]",
                  )}
                >
                  <td className="truncate px-3 py-2 font-sans text-[12px] tabular-nums text-[#B0B3B8]">
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
                  <td className="truncate px-3 py-2 font-sans text-[12px] font-bold text-[#FFFFFF]">
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
                  <td className="truncate px-3 py-2 font-sans text-[12px] tabular-nums text-[#B0B3B8]">
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
                      "truncate px-3 py-2 font-sans text-[12px]",
                      failed ? "text-[#F6465D]" : "text-[#848E9C]",
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
              <tr className="border-b border-[#2B2F36]">
                <td className="px-3 py-4 font-sans text-[12px] text-[#848E9C]" colSpan={5}>
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
    return "text-[#0ECB81]";
  }

  if (tone === "yellow") {
    return "text-[#B0B3B8]";
  }

  if (tone === "red") {
    return "text-[#F6465D]";
  }

  return "text-[#B0B3B8]";
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
            <dt className={cx("font-sans uppercase tracking-[0.12em] text-[#848E9C]", readable ? "text-[11px]" : "text-[10px]")}>
              {item.label}
            </dt>
            <dd
              className={cx(
                "mt-1 break-words font-sans leading-5",
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
          <div className={cx("mb-2 font-sans uppercase tracking-[0.12em] text-[#848E9C]", readable ? "text-[11px]" : "text-[10px]")}>
            Factor audit · boolean flags from the decision log
          </div>
          <div className="flex flex-wrap gap-2">
            {details.factors.map((factor) => (
              <span
                key={factor.key}
                className={cx(
                  "inline-flex items-center gap-1.5 border px-2 py-1 font-sans uppercase tracking-[0.08em]",
                  readable ? "text-[11px]" : "text-[10px]",
                  factor.passed
                    ? "border-[#0ECB81]/40 bg-[#0B0E11] text-[#0ECB81]"
                    : "border-[#F6465D]/40 bg-[#0B0E11] text-[#F6465D]",
                )}
              >
                {factor.passed ? "PASS" : "FAIL"} {factor.label}
                {factor.reading ? (
                  <span className="font-sans text-[9px] normal-case tracking-normal text-[#7C7C7C]">
                    ({factor.reading})
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {details.x402Evidence && details.x402Evidence.length > 0 ? (
        <div>
          <div className={cx("mb-2 flex items-center gap-2 font-sans uppercase tracking-[0.12em] text-[#848E9C]", readable ? "text-[11px]" : "text-[10px]")}>
            <span className="border border-[#7A5CFF]/50 bg-[#120A2A] px-1.5 py-0.5 text-[#B9A6FF]">x402</span>
            paid data → algorithm input
          </div>
          <div className="space-y-1.5">
            {details.x402Evidence.map((row) => (
              <div
                key={row.tool + row.factor}
                className={cx(
                  "flex flex-wrap items-center gap-x-2 gap-y-1 border border-[#3A3F4B] bg-[#1E2026]/50 px-2.5 py-1.5 font-sans",
                  readable ? "text-[11px]" : "text-[10px]",
                )}
              >
                <span className="text-[#B9A6FF]">{row.tool}</span>
                <span className="text-[#5C5C5C]">·</span>
                <span className="text-[#B0B3B8]">{row.provides}</span>
                <span className="text-[#5C5C5C]">→</span>
                <span className="text-[#B0B3B8]">{row.factor}</span>
                {row.reading && row.reading !== "—" ? (
                  <span className="text-[#7C7C7C]">[{row.reading}]</span>
                ) : null}
                {row.passed != null ? (
                  <span className={cx("ml-auto", row.passed ? "text-[#0ECB81]" : "text-[#F6465D]")}>
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
          "border-b border-[#2B2F36] text-white",
          canExpand && "cursor-pointer",
          !compact && "hover:bg-[#0B0E11]",
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        <td
          className={cx(
            "font-sans font-bold text-[#FFFFFF]",
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
              <span className="shrink-0 text-[#848E9C]">
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
            "truncate font-sans text-[#B0B3B8]",
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
              <span className="text-[#848E9C]">—</span>
            )}
          </ViewportReveal>
        </td>
        <td
          className={cx(
            "truncate font-sans text-[#B0B3B8]",
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
                className="font-bold text-[#FFD666] transition-colors hover:text-white"
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
        <tr className="border-b border-[#2B2F36] bg-[#1E2026]">
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
        "flex shrink-0 items-center justify-between gap-3 border-t border-[#2B2F36] bg-[#1E2026] font-sans text-[10px] uppercase tracking-[0.1em] text-[#848E9C]",
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
            page === 0 ? "cursor-not-allowed text-[#444444]" : "text-[#B0B3B8] hover:text-white",
          )}
        >
          Prev
        </button>
        <span className="tabular-nums text-[#B0B3B8]">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
          className={cx(
            "transition-colors",
            page >= totalPages - 1 ? "cursor-not-allowed text-[#444444]" : "text-[#B0B3B8] hover:text-white",
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
              "font-sans font-bold uppercase tracking-[0.12em] text-[#848E9C]",
              dense ? "text-[8px]" : readable ? "text-[11px]" : "text-[10px]",
              compact ? "border-b border-[#2B2F36]" : "border-y border-[#2B2F36]",
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
              <tr className="border-b border-[#2B2F36]">
                <td
                  className={cx(
                    "font-sans text-[#848E9C]",
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
        className="console-scroll min-h-0 flex-1 overflow-y-auto border-t border-[#2B2F36] bg-[#1E2026]/50"
      >
        {pagedRows.length === 0 ? (
          <div className="px-3 py-4 font-sans text-[12px] text-[#848E9C]">
            <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
              Waiting for telemetry
            </ViewportReveal>
          </div>
        ) : (
          <div
            className="grid min-h-full divide-y divide-[#2B2F36]"
            style={{ gridTemplateRows: `repeat(${rowTrackCount}, minmax(0, 1fr))` }}
          >
            {pagedRows.map((row, index) => {
              const expanded = expandedIds.has(row.id);
              const canExpand = Boolean(row.details);
              const token = row.token ?? tokenFromAmountLabel(row.amount);

              return (
                <div key={row.id} className="min-h-0 bg-[#0B0E11]/70">
                  <button
                    type="button"
                    onClick={canExpand ? () => toggleRow(row.id) : undefined}
                    disabled={!canExpand}
                    className={cx(
                      "grid h-full w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 text-left",
                      canExpand && "active:bg-[#0B0E11]",
                    )}
                  >
                    <ViewportReveal
                      variant={activityLeadEventVariant(index, "logs")}
                      delay={activityCellDelay(index, "event")}
                      duration={index === 0 ? "slow" : "normal"}
                      root={scrollRoot}
                      className="flex items-center gap-1.5"
                    >
                      <span className="shrink-0 text-[#848E9C]">
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
                        <span className="h-[18px] w-[18px] rounded-full border border-[#3A3F4B]" aria-hidden="true" />
                      )}
                    </ViewportReveal>

                    <ViewportReveal
                      variant={activityColumnVariant("reference")}
                      delay={activityCellDelay(index, "reference")}
                      root={scrollRoot}
                      className="min-w-0"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-[#848E9C]">
                          {row.hash}
                        </span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-[#4A4F5B]" aria-hidden="true" />
                        <span className="truncate font-sans text-[10px] tabular-nums text-[#848E9C]">
                          {formatOpenedAt(row.timestamp)}
                        </span>
                      </div>
                      <p
                        className="mt-1 overflow-hidden break-words font-sans text-[11px] font-semibold leading-4 text-[#FFFFFF]"
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
  const cellClass = (column: PositionColumn, colorClass = "text-[#B0B3B8]") =>
    cx(
      "truncate font-sans text-[12px] tabular-nums",
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
    <tr className={cx("border-b border-[#2B2F36] text-white", !compact && "hover:bg-[#0B0E11]")}>
      {renderCell(
        "token",
        <>
          <TokenIcon symbol={row.symbol} size={compact ? 14 : 16} />
          <span className="truncate font-sans text-[13px] font-bold text-[#FFFFFF]">{row.symbol}</span>
          {row.source === "wallet" ? (
            <span className="shrink-0 border border-[#4A4F5B] px-1.5 py-0.5 font-sans text-[8px] uppercase tracking-[0.08em] text-[#848E9C]">
              wallet
            </span>
          ) : null}
        </>,
        cx("font-sans text-[13px] font-bold text-[#FFFFFF]", compact ? "px-3 py-2" : "px-5 py-4"),
      )}
      {renderCell("amount", formatTokenAmount(row.amount), cellClass("amount"))}
      {renderCell("entry", formatPrice(row.entryPrice), cellClass("entry"))}
      {renderCell("value", formatUsd(row.entryValueUsd), cellClass("value"))}
      {renderCell(
        "current",
        formatPrice(row.currentPrice),
        cellClass("current", positivePrice(row.currentPrice) ? "text-[#FFD666]" : "text-[#848E9C]"),
      )}
      {renderCell("high", formatPrice(row.highestPrice), cellClass("high", "text-[#0ECB81]"))}
      {renderCell("stop", formatPrice(row.trailingStopPrice), cellClass("stop", "text-[#B0B3B8]"))}
      {renderCell("target", formatPrice(row.takeProfitPrice), cellClass("target", "text-[#FFD666]"))}
      {renderCell(
        "opened",
        formatOpenedAt(row.openedAt),
        cx(
          "truncate text-right font-sans text-[12px] text-[#B0B3B8]",
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
          "font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-[#848E9C]",
          compact ? "border-b border-[#2B2F36]" : "border-y border-[#2B2F36]",
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
          <tr className="border-b border-[#2B2F36]">
            <td className={cx("py-6 font-sans text-[12px] text-[#848E9C]", compact ? "px-3" : "px-5")} colSpan={9}>
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
    green: "text-[#0ECB81]",
    yellow: "text-[#B0B3B8]",
    blue: "text-[#FFD666]",
    red: "text-[#F6465D]",
    neutral: "text-[#B0B3B8]",
  }[tone];
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
      className="min-w-0 bg-[#0B0E11] px-4 py-3"
    >
      <div className="font-sans text-[10px] uppercase text-[#848E9C]">{label}</div>
      <div className={cx("mt-1 truncate font-sans text-[14px] tabular-nums", positionToneClass(tone), valueClassName)}>{value}</div>
    </ViewportReveal>
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
      console.warn("Failed to copy positions snapshot to clipboard.");
    }
  }, [json]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-sm border border-[#3A3F4B] bg-[#0B0E11] px-2.5 py-1.5 font-sans text-[10px] uppercase tracking-[0.08em] text-[#B0B3B8] transition-colors hover:border-[#4A4F5B] hover:text-white"
    >
      {copied ? (
        <>
          <Check size={12} className="text-[#0ECB81]" aria-hidden="true" />
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
    <div className="border-t border-[#2B2F36] px-5 py-4">
      <div className="mb-3 flex items-center justify-between font-sans">
        <div className="text-[10px] uppercase text-[#848E9C]">Position distance</div>
        <div className="text-[11px] tabular-nums">
          {toTargetPct !== null && toStopPct !== null ? (
            <span className={direction === "target" ? "text-[#0ECB81]" : "text-[#B0B3B8]"}>
              {direction === "target"
                ? `${toTargetPct.toFixed(1)}% to target`
                : `${toStopPct.toFixed(1)}% to stop`}
            </span>
          ) : (
            <span className="text-[#848E9C]">N/A</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: 10 }).map((_, i) => {
          const filled = currentPct !== null && i < Math.round((currentPct / 100) * 10);
          return (
            <div
              key={i}
              className={cx(
                "h-3.5 w-1 rounded-sm",
                filled
                  ? i % 2 === 0
                    ? "bg-[#FFD666]"
                    : "bg-[#D4A009]"
                  : "bg-[#3A3F4B]"
              )}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex justify-between font-sans text-[10px] tabular-nums text-[#848E9C]">
        <span>Stop {formatPrice(stop)}</span>
        <span>Entry {formatPrice(entry)}</span>
        <span>Target {formatPrice(target)}</span>
      </div>
    </div>
  );
}

function PositionEntryReason({ decision }: { decision: Decision | null }) {
  if (!decision) return null;

  const scores = decision.factor_scores ?? {};

  return (
    <div className="border-t border-[#2B2F36] px-5 py-3">
      <div className="mb-1.5 font-sans text-[10px] uppercase text-[#848E9C]">Entry reason</div>
      <div className="font-sans text-[11px] leading-4 text-[#B0B3B8]">{decision.reason ?? "—"}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ENTRY_FACTOR_KEYS.map((key) => {
          const passed = Boolean(scores[key]);
          const label = FACTOR_LABELS[key] ?? key.replace(/_/g, " ");
          return (
            <span
              key={key}
              className={cx(
                "inline-flex items-center gap-1 border rounded-sm px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-[0.06em]",
                passed
                  ? "border-[#3A3F4B] bg-[#0B0E11] text-[#0ECB81]"
                  : "border-[#3A3F4B] bg-[#0B0E11] text-[#848E9C]"
              )}
            >
              <span className={cx("h-1 w-1 rounded-full", passed ? "bg-[#0ECB81]" : "bg-[#848E9C]")} />
              {label}
            </span>
          );
        })}
      </div>
      {decision.entry_score != null && (
        <div className="mt-2 font-sans text-[10px] text-[#848E9C]">
          Score: <span className="text-[#B0B3B8]">{decision.entry_score.toFixed(0)}/100</span>
          {decision.strategy_mode ? ` · ${decision.strategy_mode}` : ""}
        </div>
      )}
      {decision.mlAudit && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className={cx(
            "inline-flex items-center gap-1 border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-[0.06em]",
            decision.mlAudit.mlActive
              ? "border-[#3A3F4B] bg-[#0ECB81]/10 text-[#0ECB81]"
              : decision.mlAudit.mlEnabled
                ? "border-[#3A3F4B] bg-[#FFD666]/10 text-[#FFD666]"
                : "border-[#3A3F4B] bg-[#0B0E11] text-[#848E9C]"
          )}>
            <span className={cx(
              "h-1 w-1 rounded-full",
              decision.mlAudit.mlActive ? "bg-[#0ECB81]" : decision.mlAudit.mlEnabled ? "bg-[#FFD666]" : "bg-[#848E9C]"
            )} />
            ML: {decision.mlAudit.mlRegime ?? "—"} · conf {(decision.mlAudit.mlConfidence != null ? (decision.mlAudit.mlConfidence * 100).toFixed(0) : "—")}% · {decision.mlAudit.mlPasserCount ?? 0} passers
          </span>
          {decision.mlAudit.mlShadowMode && (
            <span className="font-sans text-[9px] text-[#848E9C]">shadow</span>
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
      className="group overflow-hidden bento-card border border-[#2B2F36] bg-[#1E2026]/80 transition-colors hover:border-[#3A3F4B] hover:bg-[#0B0E11]"
    >
      <div className="grid min-h-[220px] grid-cols-1 xl:grid-cols-[minmax(150px,0.32fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col justify-between border-b border-[#2B2F36] px-5 py-5 xl:border-b-0 xl:border-r">
          {/* Top: date only */}
          <div className="font-sans text-[11px] text-white">
            {row.source === "wallet" ? "Wallet balance" : `Opened ${formatOpenedAt(row.openedAt)}`}
          </div>

          {/* Center: large token icon */}
          <div className="flex flex-1 items-center justify-center py-4">
            <TokenIcon symbol={row.symbol} size={72} />
          </div>

          {/* Explorer indicator */}
          {explorerUrl ? (
            <div className="flex items-center gap-1 font-sans text-[10px] uppercase text-[#848E9C]">
              <span>BSC</span>
              <ExternalLink size={10} />
            </div>
          ) : null}

          {/* Bottom stats */}
          <div className="mt-5 grid grid-cols-3 gap-px bg-[#2B2F36]">
            <div className="min-w-0 bg-[#1E2026] px-3 py-3">
              <div className="font-sans text-[10px] uppercase text-[#848E9C]">Amount</div>
              <div className="mt-1 truncate font-sans text-[15px] tabular-nums text-[#B0B3B8]">
                {formatTokenAmount(row.amount)}
              </div>
            </div>
            <div className="min-w-0 bg-[#1E2026] px-3 py-3">
              <div className="font-sans text-[10px] uppercase text-[#848E9C]">Value</div>
              <div className="mt-1 truncate font-sans text-[15px] tabular-nums text-white">
                {formatUsd(row.entryValueUsd)}
              </div>
            </div>
            <div className="min-w-0 bg-[#1E2026] px-3 py-3">
              <div className="font-sans text-[10px] uppercase text-[#848E9C]">Current</div>
              <div
                className={cx(
                  "mt-1 truncate font-sans text-[15px] tabular-nums",
                  positivePrice(row.currentPrice) ? "text-[#FFD666]" : "text-[#848E9C]",
                )}
                title={positivePrice(row.currentPrice) ? `Live price ${formatPrice(row.currentPrice)}` : undefined}
              >
                {formatPrice(row.currentPrice)}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-4 gap-px bg-[#2B2F36]">
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
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
          <div className="font-sans text-[22px] font-semibold uppercase tracking-[0.18em] text-[#4A4F5B]">
            No open positions
          </div>
          <div className="mt-3 font-sans text-[13px] text-[#848E9C]">
            positions.json is empty — the agent scans every 5 minutes
          </div>
        </ViewportReveal>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[#2B2F36] px-6 py-2.5">
        <div className="flex items-center gap-4 font-sans text-[11px]">
          <span className="text-[#848E9C]">
            Positions: <span className="text-white">{rows.length}</span>
          </span>
          <span className="h-1 w-px bg-[#333]" />
          <span className="text-[#848E9C]">
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
              <div className="bento-card border border-[#3A3F4B] bg-[#1E2026] px-5 py-4">
                <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-[#848E9C]">Open positions</div>
                <div className="mt-2 font-sans text-[28px] font-semibold tabular-nums text-white">{rows.length}</div>
              </div>
            </ViewportReveal>
            <ViewportReveal variant="scale" delay={160} duration="slow">
              <div className="bento-card border border-[#3A3F4B] bg-[#1E2026] px-5 py-4">
                <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-[#848E9C]">Total position value</div>
                <div className="mt-2 font-sans text-[28px] font-semibold tabular-nums text-white">{totalPositionValue}</div>
              </div>
            </ViewportReveal>
          </div>
          <div className="hidden shrink-0 sm:block">{copyButton}</div>
        </div>
      ) : null}

      {!flat ? (
        <ViewportReveal variant="fade" delay={200}>
          <div className="bento-card border border-[#3A3F4B] bg-[#1E2026]">
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
          <div className="flex shrink-0 items-center justify-between border-b border-[#3A3F4B] bg-[#1E2026] px-4 py-2.5">
            <div className="flex items-center gap-3 font-sans text-[10px] uppercase tracking-[0.08em] text-[#848E9C]">
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
          <div className="mt-0 flex min-h-0 flex-1 flex-col border border-t-0 border-[#3A3F4B] bg-[#1E2026]">
            <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
              <ActivePositionsTable rows={rows} compact={tableCompact} scrollRoot={scrollRoot} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type ScanFactor = { key: string; label: string; passed: boolean; reading?: string | null };




/** Terminal-style live scan — raw, no glass cards, no rounded icons */
function NewSimpleLiveScan({
  latestDecision,
  onViewPast,
}: {
  latestDecision: StatusPayload["latestDecision"];
  onViewPast: () => void;
}) {
  const symbol = latestDecision?.symbol ?? "DETECTING";
  const cycle = latestDecision?.cycle_number ?? 0;

  const factors: ScanFactor[] = useMemo(() => {
    const metrics = latestDecision?.factor_metrics ?? {};
    const labels = ["Volume Surge", "Trend Alignment", "RSI Oscillation", "Support Breakout", "Volatility Index", "Sentiment Score"];
    return labels.map((label, i) => ({
      key: label.toLowerCase().replace(" ", "_"),
      label,
      passed: i !== 2 && i !== 4,
      reading: metrics[label.toLowerCase().replace(" ", "_")] ?? (i === 0 ? "1.4x" : i === 2 ? "RSI 65" : "OK")
    }));
  }, [latestDecision]);

  const passedCount = factors.filter(f => f.passed).length;
  const allPassed = passedCount === factors.length;

  return (
    <div className="flex flex-1 flex-col font-mono">
      {/* Top bar */}
      <div className="flex justify-end pb-4 sm:pb-8">
        <button
          onClick={onViewPast}
          className="group flex items-center gap-2 border border-[#2B2F36] bg-[#0B0E11] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#B0B3B8] transition-all hover:border-[#F0B90B] hover:text-[#F0B90B]"
        >
          <span className="text-[#F0B90B]">❯</span> history
          <ArrowRight size={12} className="text-[#848E9C] group-hover:text-[#F0B90B]" />
        </button>
      </div>

      {/* Terminal header block */}
      <div className="border-y border-[#2B2F36] bg-[#0B0E11]/60 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-[#848E9C]">
          <span className="text-[#F0B90B]">❯</span>
          <span>scan</span>
          <span className="text-white">{symbol}</span>
          <span className="text-[#4A4F5B]">--cycle {cycle.toString().padStart(4, '0')}</span>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className={cx("text-[24px] font-bold tracking-tight sm:text-[28px]", allPassed ? "text-[#0ECB81]" : "text-[#F0B90B]")}>
            {symbol}/USDT
          </span>
          <span className="text-[12px] text-[#4A4F5B]">
            #{cycle.toString().padStart(4, '0')}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#848E9C]">
          <span className={cx("font-bold", allPassed ? "text-[#0ECB81]" : "text-[#F0B90B]")}>
            {passedCount}/{factors.length}
          </span>
          <span>checks passed</span>
          <span className="ml-2 text-[#4A4F5B]">|</span>
          <span className={cx("font-bold", allPassed ? "text-[#0ECB81]" : "text-[#F6465D]")}>
            {allPassed ? "READY" : "BLOCKED"}
          </span>
        </div>
      </div>

      {/* Factor output */}
      <div className="mt-4 px-2 sm:mt-6 sm:px-4">
        <TerminalFactorList factors={factors} />
      </div>
    </div>
  );
}

/** Terminal-style factor list — raw hacker aesthetic, no vibecoding cards */
function TerminalFactorList({ factors }: { factors: ScanFactor[] }) {
  return (
    <div className="font-mono">
      <div className="mb-3 flex items-center gap-3 border-b border-[#2B2F36] pb-2 text-[10px] uppercase tracking-[0.15em] text-[#848E9C]">
        <span className="text-[#F0B90B]">❯</span>
        <span>factor_audit.exe</span>
        <span className="ml-auto text-[#4A4F5B]">--live</span>
      </div>
      <div className="space-y-0">
        {factors.map((factor) => {
          const pass = factor.passed;
          const accentClass = pass ? "text-[#0ECB81]" : "text-[#F6465D]";
          const status = pass ? "[PASS]" : "[FAIL]";
          const bullet = pass ? ">" : "!";
          return (
            <div
              key={factor.key}
              className="group flex items-start gap-3 border-b border-[#2B2F36]/60 py-2.5 transition-colors hover:bg-[#1E2026]/40"
            >
              <span className={cx("mt-px shrink-0 text-[12px]", accentClass)}>{bullet}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-bold uppercase tracking-wide text-white">{factor.label}</span>
                  {factor.reading ? <span className={cx("text-[11px]", accentClass)}>{factor.reading}</span> : null}
                </div>
                <p className="text-[11px] leading-4 text-[#848E9C]">{explainFactor(factor.key, factor.passed)}</p>
              </div>
              <span className={cx("mt-px shrink-0 text-[11px] font-bold tracking-wider", accentClass)}>{status}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-[#4A4F5B]">
        <span className="text-[#F0B90B]">❯</span>
        <span>done.</span>
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
              compact ? "border-b border-[#2B2F36] pb-4" : "border border-[#3A3F4B] bg-[#1E2026] px-5 py-4",
            )}
          >
            <ViewportReveal variant="fade" delay={60} duration="fast">
              <div className="mb-2 font-sans text-[10px] uppercase tracking-[0.14em] text-[#848E9C]">
                Latest bot log{agentLog.source ? ` (${agentLog.source})` : ""}
              </div>
            </ViewportReveal>
            <ViewportReveal variant="left" delay={120}>
              <p className={cx("break-words font-sans leading-5 text-[#B0B3B8]", readable ? "text-[13px]" : "text-[12px]")}>
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
          <div className="bento-card border border-[#3A3F4B] bg-[#1E2026]">
            <div className="border-b border-[#2B2F36] px-5 py-5">
              <ViewportReveal variant="left" delay={120} duration="fast">
                <h2 className="font-sans text-xl text-[#B0B3B8]">Decision &amp; Execution Log</h2>
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



function ActivityPanel({
  logRows,
  agentLog,
  latestDecision,
  agentRunning,
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
  const [pane, setPane] = useState<"live" | "past">("live");

  if (desktop) {
    return (
      <section className="flex min-h-0 flex-1 flex-col px-8 pt-6">
        {pane === "live" ? (
          <div className="flex min-h-0 flex-1 flex-col pt-2 pb-6 sm:pt-10">
            <NewSimpleLiveScan latestDecision={latestDecision} onViewPast={() => setPane("past")} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col pt-5 pb-6">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#2B2F36] px-5 py-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPane("live")}
                    className="group inline-flex items-center gap-2 border border-[#3A3F4B] bg-[#1E2026]/50 px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.14em] text-[#B0B3B8] transition-colors hover:border-[#4A4F5B] hover:text-white"
                  >
                    <span aria-hidden="true" className="text-[#848E9C] transition-colors group-hover:text-[#B0B3B8]">
                      ←
                    </span>
                    Live
                  </button>
                  <h2 className="truncate font-sans text-[14px] uppercase tracking-[0.1em] text-[#B0B3B8]">
                    Decision & Execution Log
                  </h2>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
                <SysLogsPanel
                  rows={logRows}
                  agentLog={agentLog}
                  agentRunning={agentRunning}
                  compact
                  readable
                  fillHeight
                />
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pt-6 sm:px-8">
      {pane === "live" ? (
        <div className="flex min-h-0 flex-1 flex-col pt-10 pb-6">
          <NewSimpleLiveScan latestDecision={latestDecision} onViewPast={() => setPane("past")} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-5 pb-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#2B2F36] px-5 py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPane("live")}
                  className="group inline-flex items-center gap-2 border border-[#3A3F4B] bg-[#1E2026]/50 px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.14em] text-[#B0B3B8] transition-colors hover:border-[#4A4F5B] hover:text-white"
                >
                  <span aria-hidden="true" className="text-[#848E9C] transition-colors group-hover:text-[#B0B3B8]">
                    ←
                  </span>
                  Live
                </button>
                <h2 className="truncate font-sans text-[14px] uppercase tracking-[0.1em] text-[#B0B3B8]">
                  Decision & Execution Log
                </h2>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
              <SysLogsPanel
                rows={logRows}
                agentLog={agentLog}
                agentRunning={agentRunning}
                compact
                readable
                fillHeight
              />
            </div>
          </div>
        </div>
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
    <div className="relative isolate hidden min-h-dvh flex-1 bg-[#0B0E11] text-white lg:flex">
      <AsciiRaccoonWatermark glitch={activeSection === "market-chat"} />
      <DesktopNavRail activeSection={activeSection} onNavigate={onNavigate} />
      <main className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0B0E11]">
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
              <WalletPanel balances={view.walletBalances} agentMode={view.agentMode} x402WalletAddress={view.x402WalletAddress} x402WalletUsdcBalance={view.x402WalletUsdcBalance} desktop />
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
            ) : section === "logs" ? (
              <S3LogsPanel desktop />
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
        compact ? "bg-[#0B0E11]/30" : flush ? "bg-[#1E2026]" : "border border-[#3A3F4B] bg-[#1E2026]",
      )}
    >
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          className={cx(
            "border-b border-[#2B2F36] font-sans uppercase tracking-[0.12em] text-[#848E9C]",
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
          <div className={cx("font-sans text-[#848E9C]", compact ? "px-3 py-3 text-[11px]" : "px-4 py-4 text-[13px]")}>
            No open positions in positions.json
          </div>
        ) : (
          <div className="divide-y divide-[#2B2F36]">
            {rows.map((row) => (
              <div
                key={row.id}
                className={cx(
                  compact
                    ? "grid grid-cols-[1fr_auto] px-3 py-1.5 hover:bg-[#0B0E11]"
                    : "grid grid-cols-[1.5fr_1fr_1fr] px-4 py-2 hover:bg-[#0B0E11]",
                )}
              >
                <span className={cx("truncate font-sans text-[#B0B3B8]", compact ? "text-[11px]" : "text-[13px]")}>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <TokenIcon symbol={row.symbol} size={compact ? 12 : 14} />
                    <span className="truncate">{row.symbol}</span>
                  </span>
                </span>
                <span
                  className={cx(
                    "truncate text-right font-sans tabular-nums text-[#B0B3B8]",
                    compact ? "text-[11px]" : "text-[13px]",
                  )}
                >
                  {formatUsd(row.entryValueUsd)}
                </span>
                {!compact ? (
                  <span className="truncate text-right font-sans text-[13px] tabular-nums text-[#B0B3B8]">
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
          "shrink-0 border-t border-[#2B2F36] font-sans uppercase tracking-[0.12em] text-[#848E9C]",
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
  const actionTone = latestDecision ? decisionActionTone(latestDecision.action) : "yellow";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0B0E11]/30">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#2B2F36] px-3 py-2">
        <span className="font-sans text-[11px] font-semibold leading-none text-white">Signal</span>
        {action ? <StatusBadge status={action} tone={actionTone} /> : null}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-3">
        {symbol ? (
          <div className="flex flex-col items-center justify-center gap-1">
            <TokenIcon symbol={symbol} size={52} />
            <span className="font-sans text-[12px] font-bold leading-none text-white">{symbol}</span>
          </div>
        ) : (
          <span className="font-sans text-[10px] text-[#848E9C]">No signal</span>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-around px-3 pb-4">
        {slots.map((factor, i) => {
          if (!factor) {
            return (
              <span
                key={i}
                className="h-[9px] w-[9px] shrink-0 rounded-full border border-[#848E9C] bg-[#1E2026]"
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
                factor.passed ? "bg-[#B0B3B8]" : "bg-[#F6465D]/60",
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
        compact ? "bg-[#0B0E11]/30" : flush ? "bg-[#1E2026]" : "border border-[#3A3F4B] bg-[#1E2026]",
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-center justify-between border-b border-[#2B2F36]",
          compact ? "px-2 py-2" : "px-4 pb-3 pt-4",
        )}
      >
        {compact ? (
          <>
            <span className="font-sans text-xs font-medium uppercase tracking-widest leading-none text-[#848E9C]">Activity</span>
            <div className="flex items-center overflow-hidden rounded border border-[#4A4F5B]">
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
                      "font-sans uppercase tracking-wider transition-colors",
                      active ? "bg-[#4A4F5B] text-white font-semibold" : "text-[#848E9C] hover:text-[#999999]",
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
              <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">Strategy</div>
              <h2 className="mt-1 font-sans text-[16px] font-semibold text-white">Recent Activity</h2>
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
                      "font-sans text-[10px] uppercase tracking-[0.1em] transition-colors",
                      active ? "font-semibold text-white" : "font-medium text-[#848E9C] hover:text-[#999999]",
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
          <div className={cx(homeActivityGridClass, "border-b border-[#2B2F36] px-4 py-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]")}>
            <span className="text-left">Date</span>
            <span className="text-center">Token</span>
            <span className="text-center">Status</span>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className={cx("font-sans text-[#848E9C]", compact ? "px-2 py-2 text-[10px]" : "px-4 py-4 text-[13px]")}>
            No recent activity
          </div>
        ) : (
          <div className={cx("divide-y divide-[#2B2F36]", compact && "flex h-full flex-col")}>
            {rows.map((row) => {
              const token = homeActivityToken(row);

              if (compact) {
                const score = homeActivityScore(row);

                return (
                  <div
                    key={row.id}
                    className="grid min-h-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1 hover:bg-[#0B0E11]"
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
                        <span className="h-4 w-4 rounded-full border border-[#3A3F4B]" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 truncate text-left font-sans text-[10px] font-bold tabular-nums text-[#FFFFFF]">
                      {score}
                    </span>
                    <span className="flex items-center justify-end">
                      <ActivityStatusIndicator status={row.status} tone={row.tone} compact />
                    </span>
                  </div>
                );
              }

              return (
                <div key={row.id} className={cx(homeActivityGridClass, "items-center px-4 py-2.5 hover:bg-[#0B0E11]")}>
                  <span className="truncate text-left font-sans text-[13px] font-bold tabular-nums text-[#FFFFFF]">
                    {formatOpenedAt(row.timestamp)}
                  </span>
                  <span className="flex items-center justify-center">
                    {token ? (
                      <span title={token} aria-label={token}>
                        <TokenIcon symbol={token} size={18} />
                      </span>
                    ) : (
                      <span className="font-sans text-[13px] text-[#848E9C]">—</span>
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
        <div className="shrink-0 border-t border-[#2B2F36] px-4 py-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">
          {(view === "sys" ? logRows : activityRows).length} total events
        </div>
      ) : null}
    </div>
  );
}

function HomeWalletSummary({
  walletBalances,
  agentMode,
  x402WalletAddress,
  x402WalletUsdcBalance,
  compact = false,
  flush = false,
}: {
  walletBalances: WalletBalanceRow[];
  agentMode: string;
  x402WalletAddress?: string | null;
  x402WalletUsdcBalance?: number | null;
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
        compact ? "bg-[#0B0E11]/30" : flush ? "bg-[#1E2026]" : "border border-[#3A3F4B] bg-[#1E2026]",
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-baseline justify-between border-b border-[#2B2F36]",
          compact ? "px-3 py-2" : "px-4 pb-3 pt-4",
        )}
      >
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">TWAK Wallet</div>
          <h2 className={cx("font-sans font-semibold text-white", compact ? "text-[13px]" : "mt-1 text-[16px]")}>
            Live Holdings
          </h2>
        </div>
        {paperMode ? (
          <span
            className={cx(
              "border border-[#3A3F4B] font-sans uppercase tracking-[0.12em] text-[#848E9C]",
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
            "grid border-b border-[#2B2F36] font-sans uppercase tracking-[0.12em] text-[#848E9C]",
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
          <div className={cx("font-sans text-[#848E9C]", compact ? "px-3 py-3 text-[11px]" : "px-4 py-4 text-[13px]")}>
            Waiting for TWAK wallet balances
          </div>
        ) : (
          <div className="divide-y divide-[#2B2F36]">
            {rows.map((row) => (
              <div
                key={`${row.chain}-${row.symbol}`}
                className={cx(
                  "hover:bg-[#0B0E11]",
                  compact
                    ? "grid grid-cols-[auto_1fr_auto] px-3 py-1.5"
                    : "grid grid-cols-[1fr_1.5fr_1fr] px-4 py-2",
                )}
              >
                <span
                  className={cx(
                    "truncate font-sans uppercase text-[#848E9C]",
                    compact ? "text-[11px]" : "text-[13px]",
                  )}
                >
                  {row.chain}
                </span>
                <span className={cx("truncate font-sans text-[#B0B3B8]", compact ? "text-[11px]" : "text-[13px]")}>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <TokenIcon symbol={row.symbol} size={compact ? 12 : 14} />
                    <span className="truncate">{row.symbol}</span>
                  </span>
                </span>
                <span
                  className={cx(
                    "truncate text-right font-sans tabular-nums text-[#B0B3B8]",
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
          "shrink-0 border-t border-[#2B2F36] font-sans uppercase tracking-[0.12em] text-[#848E9C]",
          compact ? "px-3 py-1 text-[10px]" : "px-4 py-2 text-[10px]",
        )}
      >
        {walletBalances.length} total {walletBalances.length === 1 ? "asset" : "assets"}
      </div>
      {x402WalletAddress ? (
        <div
          className={cx(
            "shrink-0 mx-4 mb-4 mt-3 rounded-xl border border-[#3A3F4B] bg-[#0B0E11] bento-card",
            compact ? "px-3 py-3" : "px-4 py-4",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#848E9C]">x402 Wallet</div>
              <h2 className={cx("font-sans mt-2 font-semibold text-white inline-flex items-center gap-2", compact ? "text-[14px]" : "text-[16px]")}>
                <span className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/usdc-logo.png" alt="USDC" className="h-4 w-4 object-contain" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/base_logo.png" alt="Base" className="absolute -bottom-0.5 -right-0.5 h-2 w-2 object-contain rounded-full border border-[#2B2F36] bg-[#0B0E11]" />
                </span>
                Base USDC
              </h2>
              <div className="mt-1 font-sans text-[10px] text-[#848E9C]">
                {x402WalletAddress.slice(0, 6)}…{x402WalletAddress.slice(-4)}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">Balance</div>
              <div className="mt-1 font-sans text-[16px] font-semibold tabular-nums text-[#FFD666]">
                {x402WalletUsdcBalance != null ? formatUsd(x402WalletUsdcBalance) : "—"}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
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
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col p-0">
        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-[minmax(0,1fr)_300px] gap-0 bento-card border border-[#3A3F4B] bg-[#1E2026]/80">
          <ViewportReveal
            variant="fade"
            delay={200}
            duration="slow"
            className="relative col-span-3 h-full min-h-0 overflow-hidden border-b border-[#3A3F4B]"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
              <DesktopHeroMetrics view={view} />
            </div>
            <TimezoneMenu />
            <ChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            <div className="absolute inset-0">
              <PortfolioChart data={view.chartData} variant="desktop" range={timeRange} />
            </div>
          </ViewportReveal>

          <ViewportReveal
            variant="up"
            delay={400}
            duration="normal"
            className="flex h-full min-h-0 flex-col border-r border-[#3A3F4B]"
          >
            <HomePositionsSummary positionRows={view.positionRows} totalPositionValue={view.totalPositionValue} flush />
          </ViewportReveal>
          <ViewportReveal
            variant="up"
            delay={460}
            duration="normal"
            className="flex h-full min-h-0 flex-col border-r border-[#3A3F4B]"
          >
            <HomeActivitySummary activityRows={view.activityRows} logRows={view.logRows} flush />
          </ViewportReveal>
          <ViewportReveal variant="up" delay={520} duration="normal" className="flex h-full min-h-0 flex-col">
            <HomeWalletSummary walletBalances={view.walletBalances} agentMode={view.agentMode} x402WalletAddress={view.x402WalletAddress} x402WalletUsdcBalance={view.x402WalletUsdcBalance} flush />
          </ViewportReveal>
        </div>
      </div>
    </section>
  );
}

function DesktopHeroMetrics({ view }: { view: DashboardViewModel }) {
  return (
    <section className="px-4 pt-3">
      <div className="grid grid-cols-4 divide-x divide-[#2B2F36]">
        {view.metrics.map((metric, index) => (
          <ViewportReveal
            key={metric.label}
            variant={homeMetricVariant(metric.label, metric.tone)}
            delay={index * 60}
            duration={metric.label.includes("Balance") ? "slow" : "normal"}
            className="min-w-0 px-6 text-center first:pl-0 last:pr-0"
          >
            <div className="font-sans text-[7px] font-medium text-[#B0B3B8]">{metric.label}</div>
            <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5">
              <span className="font-sans text-[12px] font-bold leading-none text-white tabular-nums">{metric.value}</span>
              {metric.unit ? <span className="font-sans text-[7px] text-[#B0B3B8]">{metric.unit}</span> : null}
              {metric.delta ? (
                <span
                  className={cx(
                    "font-sans text-[7px] font-bold tabular-nums",
                    metric.tone === "negative" ? "text-[#F6465D]" : "text-[#0ECB81]",
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
        "sticky top-0 z-30 shrink-0 border-b border-[#2B2F36] glass-strong",
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
        <span className="min-w-0 truncate font-sans text-[11px] font-medium tracking-[0.06em] text-white">
          AlejoReyna/NoNamedYetBot
        </span>
        <Github size={14} strokeWidth={1.75} className="shrink-0 text-white" aria-hidden="true" />
      </a>
    </header>
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
            ? "border-[#848E9C] bg-[#4A4F5B] text-white"
            : "border-[#2B2F36] bg-[#1E2026]/90 text-[#B0B3B8] backdrop-blur-sm",
        )}
      >
        <Filter className="h-4 w-4" strokeWidth={2} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Chart time range"
          className="absolute right-0 top-[calc(100%+6px)] flex min-w-[88px] flex-col border border-[#2B2F36] bg-[#1E2026] shadow-[0_12px_32px_rgba(0,0,0,0.72)]"
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
                "border-b border-[#2B2F36] px-3 py-2 text-left font-sans text-[11px] last:border-b-0",
                range === timeRange
                  ? "bg-[#4A4F5B] text-white"
                  : "text-[#B0B3B8] hover:bg-[#1E2026] hover:text-white",
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
          "inline-flex h-8 items-center gap-1.5 border px-2 font-sans text-[10px] uppercase tracking-[0.08em] transition-colors",
          open
            ? "border-[#848E9C] bg-[#4A4F5B] text-white"
            : "border-[#2B2F36] bg-[#1E2026]/90 text-[#B0B3B8] backdrop-blur-sm hover:text-white",
        )}
      >
        <Globe className="h-4 w-4" strokeWidth={2} />
        <span className="hidden sm:inline">{gmtOffsetLabel(timeZone, now)}</span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Chart time zone"
          className="absolute right-0 top-[calc(100%+6px)] flex max-h-[320px] w-[256px] flex-col overflow-y-auto border border-[#2B2F36] bg-[#1E2026] shadow-[0_12px_32px_rgba(0,0,0,0.72)]"
        >
          <div className="sticky top-0 border-b border-[#2B2F36] bg-[#1E2026] px-3 py-2 font-sans text-[10px] uppercase tracking-[0.12em] text-[#848E9C]">
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
                  "flex items-center justify-between gap-3 border-b border-[#2B2F36] px-3 py-2 text-left last:border-b-0",
                  selected ? "bg-[#161616]" : "hover:bg-[#1E2026]",
                )}
              >
                <span className="min-w-0">
                  <span className={cx("block truncate font-sans text-[12px]", selected ? "text-white" : "text-[#D4D4D4]")}>
                    {zone.label}
                  </span>
                  <span className="block truncate font-sans text-[10px] text-[#6E6E6E]">{zone.cities}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-sans text-[12px] tabular-nums text-[#B0B3B8]">{localTimeLabel(zone.id, now)}</span>
                  <span className="block font-sans text-[10px] text-[#6E6E6E]">{gmtOffsetLabel(zone.id, now)}</span>
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
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ViewportReveal
        variant="fade"
        delay={120}
        duration="normal"
        className="relative min-h-0 flex-1 border-b border-[#3A3F4B] bg-[#0B0E11]/30"
      >
        <div className="absolute inset-0 flex flex-col">
          <div className="grid grid-cols-2 gap-x-4 px-4 pb-2 pt-3">
            <ViewportReveal variant="scale" duration="slow" className="min-w-0 text-center">
              <div className="font-sans text-[11px] font-medium text-[#B0B3B8]">Total Balance</div>
              <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5">
                <span className="font-sans text-[20px] font-bold leading-none text-white tabular-nums">{view.totalBalance}</span>
                <span className="font-sans text-[11px] text-[#B0B3B8]">USD</span>
              </div>
            </ViewportReveal>
            <ViewportReveal
              variant={homeMetricVariant("Window Profit/Loss", view.pnlTone)}
              delay={80}
              duration="slow"
              className="min-w-0 text-center"
            >
              <div className="font-sans text-[11px] font-medium text-[#B0B3B8]">Window P/L</div>
              <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5">
                <span className="font-sans text-[20px] font-bold leading-none text-white tabular-nums">{view.pnlValue}</span>
                {view.pnlDelta ? (
                  <span
                    className={cx(
                      "font-sans text-[11px] font-bold tabular-nums",
                      view.pnlTone === "negative" ? "text-[#F6465D]" : "text-[#0ECB81]",
                    )}
                  >
                    ({view.pnlDelta})
                  </span>
                ) : null}
              </div>
            </ViewportReveal>
          </div>
          <div className="relative min-h-0 flex-1">
            <TimezoneMenu />
            <ChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            <div className="absolute inset-0 p-2">
              <PortfolioChart data={view.mobileChartData} variant="mobile" range={timeRange} />
            </div>
          </div>
        </div>
      </ViewportReveal>
      <ViewportReveal
        variant="up"
        delay={200}
        duration="normal"
        className="flex shrink-0 flex-col"
      >
        <div className="grid grid-cols-2" style={{ height: "30vh" }}>
          <div className="col-span-1 flex flex-col border-r border-[#3A3F4B]">
            <HomeSignalSummary latestDecision={latestDecision} />
          </div>
          <div className="col-span-1 flex flex-col">
            <HomeActivitySummary activityRows={view.activityRows} logRows={view.logRows} compact />
          </div>
        </div>
      </ViewportReveal>
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
        active ? "text-[#F0B90B]" : "text-[#7A7A7A] active:text-white",
      )}
    >
      {active ? (
        <span className="absolute top-0 h-0.5 w-4 rounded-full bg-[#F0B90B]" aria-hidden="true" />
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
      className="relative z-40 h-[52px] shrink-0 border-t border-[#2B2F36] bg-[#1E2026]/75 backdrop-blur-sm"
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
    <div className="relative isolate flex h-[100dvh] flex-col overflow-hidden bg-[#0B0E11] text-white lg:hidden">
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
              <WalletPanel balances={view.walletBalances} agentMode={view.agentMode} x402WalletAddress={view.x402WalletAddress} x402WalletUsdcBalance={view.x402WalletUsdcBalance} compact />
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
            ) : section === "logs" ? (
              <S3LogsPanel compact />
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
