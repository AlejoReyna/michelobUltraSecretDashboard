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
  ChevronDown,
  ChevronRight,
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
  formatDecisionEvent,
  resolveAgentLogLine,
} from "@/lib/agent-log";
import {
  cycleCountdownMs,
  formatCycleCountdown,
  inferCycleIntervalMs,
  nextCycleAt,
} from "@/lib/cycle-timing";
import { breakoutEntryScoreStats, entryFactorStats, resolveStrategyMode } from "@/lib/factor-scoring";
import { scalpingFactorStats } from "@/lib/scalping-scoring";
import {
  detailsFromDecision,
  detailsFromExecution,
  detailsFromMovement,
  type LogEventDetails,
} from "@/lib/log-event-details";
import { statusSchema, type StatusPayload } from "@/lib/schemas";

type DashboardSection = "overview" | "positions" | "activity" | "wallet" | "algorithm" | "market-chat";
type ActivityView = "txs" | "sys";

const dashboardNavItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Home", icon: Home, section: "overview" },
  { label: "Positions", icon: Layers, section: "positions" },
  { label: "Activity", icon: Activity, section: "activity" },
  { label: "Intel", icon: Terminal, section: "market-chat" },
  { label: "Wallet", icon: Wallet, section: "wallet" },
  { label: "Guide", icon: BookOpen, section: "algorithm" },
];

const DESKTOP_NAV_WIDTH = 56;
const defaultDeviceTopSectionColor = "#000000";
const focusedDeviceTopSectionColor = "#111111";
const focusedDeviceTopSections = new Set<DashboardSection>(["positions", "wallet", "market-chat"]);

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

type DashboardViewModel = {
  metrics: MetricView[];
  activityRows: ActivityRow[];
  logRows: ActivityRow[];
  positionRows: PositionRow[];
  totalPositionValue: string;
  walletBalances: WalletBalanceRow[];
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

function activityFromTelemetry(data: StatusPayload | null): ActivityRow[] {
  const executionTokens = executionTokenByTxHash(data);
  const executionTimestampTokens = executionTokenByTimestamp(data);

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
          id: `decision-${decision.cycle_number ?? decision.timestamp ?? index}`,
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
          id: `decision-${decision.cycle_number ?? decision.timestamp ?? index}`,
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

function activePositionRowsFromTelemetry(data: StatusPayload | null): PositionRow[] {
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
      highestPrice: position.highest_price ?? null,
      trailingStopPrice: position.trailing_stop_price ?? null,
      takeProfitPrice: position.take_profit_price ?? null,
      openedAt: position.opened_at ?? null,
    }));

  const trackedSymbols = new Set(trackedRows.map((row) => competitionTokenKey(row.symbol)));
  const walletRows = boughtTokensFromTelemetry(data)
    .filter((holding) => holding.status === "HELD" && !trackedSymbols.has(competitionTokenKey(holding.symbol)))
    .map((holding) => ({
      id: `wallet-position-${holding.chain}-${holding.symbol}`,
      symbol: holding.symbol,
      source: "wallet" as const,
      amount: holding.amount,
      entryPrice: null,
      entryValueUsd: holding.valueUsd ?? holding.entryValueUsd,
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

function formatPrice(value: number | null) {
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
    <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-[14%]" />
        <col className="w-[12%]" />
        <col className="w-[12%]" />
        <col className="w-[12%]" />
        <col className="w-[12%]" />
        <col className="w-[12%]" />
        <col className="w-[12%]" />
        <col className="w-[14%]" />
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
            <td className={cx("py-6 font-mono text-[12px] text-[#8A8A8A]", compact ? "px-3" : "px-5")} colSpan={8}>
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
}: {
  label: string;
  value: string;
  column: PositionColumn;
  index: number;
  tone?: PositionTone;
}) {
  return (
    <ViewportReveal
      variant={positionColumnVariant(column)}
      delay={positionCellDelay(index, column)}
      duration="fast"
      className="min-w-0 bg-[#030303] px-4 py-3"
    >
      <div className="font-mono text-[10px] uppercase text-[#757575]">{label}</div>
      <div className={cx("mt-1 truncate font-mono text-[14px] tabular-nums", positionToneClass(tone))}>{value}</div>
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
            </div>
            <div className="font-mono text-[10px] uppercase text-[#8FD9FF]">Target</div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3 font-mono text-[11px] tabular-nums">
            <div className="min-w-0">
              <div className="text-[#666666]">Stop</div>
              <div className="truncate text-[#FFD21A]">{formatPrice(stop)}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[#666666]">Entry</div>
              <div className="truncate text-white">{formatPrice(entry)}</div>
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

function DesktopPositionCard({
  row,
  index,
  explorerUrl,
  scrollRoot,
}: {
  row: PositionRow;
  index: number;
  explorerUrl: string | null;
  scrollRoot: Element | null;
}) {
  const status = positionStatus(row);

  const body = (
    <ViewportReveal
      variant={index === 0 ? positionLeadVariant(index) : "fade"}
      delay={index * 70}
      duration={index === 0 ? "slow" : "normal"}
      root={scrollRoot}
      className="group overflow-hidden border border-[#1A1A1A] bg-black/80 transition-colors hover:border-[#2A2A2A] hover:bg-[#030303]"
    >
      <div className="grid min-h-[220px] grid-cols-1 xl:grid-cols-[minmax(250px,0.72fr)_minmax(0,1.28fr)]">
        <div className="flex min-w-0 flex-col justify-between border-b border-[#1A1A1A] px-5 py-5 xl:border-b-0 xl:border-r">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <TokenIcon symbol={row.symbol} size={44} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[26px] font-bold leading-none text-white">
                      {row.symbol}
                    </span>
                    {explorerUrl ? (
                      <span
                        className="shrink-0 font-mono text-[13px] text-[#666666] opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      >
                        -&gt;
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-[#757575]">
                    {row.source === "wallet" ? "Wallet balance" : `Opened ${formatOpenedAt(row.openedAt)}`}
                  </div>
                </div>
              </div>
              <span
                className={cx(
                  "shrink-0 border px-2 py-1 font-mono text-[10px] uppercase",
                  positionBadgeClass(status.tone),
                )}
              >
                {status.label}
              </span>
            </div>

            <p className="mt-5 max-w-[32rem] break-words font-mono text-[12px] leading-5 text-[#8A8A8A]">
              {status.detail}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-px bg-[#141416]">
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
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-px bg-[#141416] md:grid-cols-3">
            <PositionMetricCell label="Entry" value={formatPrice(row.entryPrice)} column="entry" index={index} />
            <PositionMetricCell
              label="High"
              value={formatPrice(row.highestPrice)}
              column="high"
              index={index}
              tone={positivePrice(row.highestPrice) ? "green" : "neutral"}
            />
            <PositionMetricCell
              label="Stop"
              value={formatPrice(row.trailingStopPrice)}
              column="stop"
              index={index}
              tone={positivePrice(row.trailingStopPrice) ? "yellow" : "neutral"}
            />
            <PositionMetricCell
              label="Target"
              value={formatPrice(row.takeProfitPrice)}
              column="target"
              index={index}
              tone={positivePrice(row.takeProfitPrice) ? "blue" : "neutral"}
            />
            <PositionMetricCell label="Opened" value={formatOpenedAt(row.openedAt)} column="opened" index={index} />
            <PositionMetricCell
              label="Source"
              value={row.source === "wallet" ? "Wallet" : "positions.json"}
              column="value"
              index={index}
              tone={row.source === "wallet" ? "yellow" : "green"}
            />
          </div>
          <PositionRiskCorridor row={row} />
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
}: {
  rows: PositionRow[];
  executions: StatusPayload["executions"];
  walletAddress: string | null;
  totalPositionValue: string;
  scrollRoot: Element | null;
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
    <div className="flex min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-[#1A1A1A] bg-[#1A1A1A] xl:grid-cols-4">
        {summaryBlocks.map((block, index) => (
          <PositionSummaryBlock
            key={block.label}
            label={block.label}
            value={block.value}
            detail={block.detail}
            tone={block.tone}
            index={index}
            scrollRoot={scrollRoot}
          />
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(270px,320px)]">
        <div className="min-w-0 space-y-4">
          {rows.map((row, index) => (
            <DesktopPositionCard
              key={row.id}
              row={row}
              index={index}
              explorerUrl={positionExplorerUrl(row, executions, walletAddress)}
              scrollRoot={scrollRoot}
            />
          ))}
        </div>
        <PositionsInsightRail
          rows={rows}
          nearestStop={nearestStop}
          nearestTarget={nearestTarget}
          totalPositionValue={totalPositionValue}
          scrollRoot={scrollRoot}
        />
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
}: {
  rows: PositionRow[];
  totalPositionValue: string;
  agentMode: string;
  executions?: StatusPayload["executions"];
  walletAddress?: string | null;
  compact?: boolean;
  desktop?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const paperMode = agentMode === "PAPER";
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
        !flat && "px-10 py-9",
      )}
    >
      <div className={cx(flat ? "shrink-0 border-b border-[#1A1A1A] pb-4" : "mb-6")}>
        <ViewportReveal variant="blur" duration="slow">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy</div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <h1
              className={cx(
                "font-mono font-semibold leading-tight text-white",
                flat ? "text-[28px]" : "text-[32px]",
              )}
            >
              Active Positions
            </h1>
            {flat && !(desktop && !compact) ? (
              <div className="shrink-0 text-right font-mono">
                <ViewportReveal variant="fade" delay={70} duration="fast">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[#757575]">
                    {rows.length} {rows.length === 1 ? "position" : "positions"}
                  </div>
                </ViewportReveal>
                <ViewportReveal variant="scale" delay={130} duration="slow">
                  <div className="mt-1 text-sm tabular-nums text-white">{totalPositionValue}</div>
                </ViewportReveal>
              </div>
            ) : !flat ? (
              <ViewportReveal variant="scale" delay={90} duration="fast">
                <StatusBadge status={agentMode} tone={paperMode ? "yellow" : "green"} />
              </ViewportReveal>
            ) : null}
          </div>
          {!flat ? (
            <ViewportReveal variant="left" delay={140}>
              <p className="mt-2 max-w-3xl font-mono text-[12px] leading-5 text-[#8A8A8A]">
                Open holdings tracked in `positions.json` on EC2. Entry price, trailing stop, and take-profit levels are
                maintained by the agent after each decision cycle.
              </p>
            </ViewportReveal>
          ) : null}
        </ViewportReveal>
        {!flat ? (
          <ViewportReveal variant="expand" delay={180} duration="slow" className="mt-4 h-px w-full bg-[#1A1A1A]" />
        ) : null}
      </div>

      {!flat ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
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
      ) : null}

      {!flat ? (
        <ViewportReveal variant="fade" delay={200}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div className="border-b border-[#1A1A1A] px-5 py-5">
              <ViewportReveal variant="left" delay={240} duration="fast">
                <h2 className="font-mono text-xl text-[#DADADA]">Position Book</h2>
              </ViewportReveal>
            </div>
            <div ref={scrollRef} className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
              <ActivePositionsTable rows={rows} compact={tableCompact} scrollRoot={scrollRoot} />
            </div>
          </div>
        </ViewportReveal>
      ) : desktop && !compact ? (
        <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-y-auto">
          <DesktopPositionsBoard
            rows={rows}
            executions={executions}
            walletAddress={walletAddress}
            totalPositionValue={totalPositionValue}
            scrollRoot={scrollRoot}
          />
        </div>
      ) : (
        <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <ActivePositionsTable rows={rows} compact={tableCompact} scrollRoot={scrollRoot} />
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
  const flat = panelUsesFlatChrome(compact, desktop);

  if (desktop) {
    return (
      <section className="flex min-h-0 flex-1 flex-col px-8 pt-6">
        <div className="shrink-0 border-b border-[#1A1A1A] pb-4">
          <div className="flex items-end justify-between gap-4">
            <ViewportReveal variant="blur" duration="slow" className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Telemetry</div>
              <h1 className="mt-2 font-mono text-[28px] font-semibold leading-tight text-white">Activity</h1>
            </ViewportReveal>
            <ActivityTabSelector value={view} onChange={setView} compact />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-6 pt-5">
          <div className="flex min-h-0 flex-col">
            <ActivityViewTransition view={view} className="flex min-h-0 flex-1 flex-col">
              {(activeView) =>
                activeView === "txs" ? (
                  <TxActivityPanel rows={activityRows} compact readable />
                ) : (
                  <SysLogsPanel
                    rows={logRows}
                    agentLog={agentLog}
                    latestDecision={latestDecision}
                    agentRunning={agentRunning}
                    compact
                    readable
                  />
                )
              }
            </ActivityViewTransition>
          </div>

          <div className="flex min-h-0 flex-col">
            <LiveScanPanel
              latestDecision={latestDecision}
              decisions={decisions}
              agentRunning={agentRunning}
              compact
              readable
            />
          </div>
        </div>
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
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
                executions={data?.executions ?? []}
                walletAddress={data?.wallet.address ?? null}
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
      <div
        className={cx(
          "flex shrink-0 items-baseline justify-between border-b border-[#141416]",
          compact ? "px-3 py-2" : "px-4 pb-3 pt-4",
        )}
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy</div>
          <h2 className={cx("font-mono font-semibold text-white", compact ? "text-[13px]" : "mt-1 text-[16px]")}>
            Active Positions
          </h2>
        </div>
        <span className={cx("font-mono tabular-nums text-[#B8B8B8]", compact ? "text-[11px]" : "text-[13px]")}>
          {totalPositionValue}
        </span>
      </div>
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
      <DesktopHeroMetrics view={view} />
      <div className="flex min-h-0 flex-1 flex-col pb-6 pr-8 pt-3">
        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-[minmax(0,1fr)_300px] gap-0 border border-[#1E1E1E] bg-black/80">
          <ViewportReveal
            variant="fade"
            delay={200}
            duration="slow"
            className="relative col-span-3 h-full min-h-0 overflow-hidden border-b border-[#1E1E1E]"
          >
            <TimezoneMenu />
            <ChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            <div className="absolute inset-0">
              <PortfolioChart data={view.chartData} variant="desktop" />
            </div>
          </ViewportReveal>

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
        </div>
      </div>
    </section>
  );
}

function DesktopHeroMetrics({ view }: { view: DashboardViewModel }) {
  return (
    <section className="shrink-0 pr-8 pt-6">
      <div className="grid grid-cols-4 divide-x divide-[#1A1A1A]">
        {view.metrics.map((metric, index) => (
          <ViewportReveal
            key={metric.label}
            variant={homeMetricVariant(metric.label, metric.tone)}
            delay={index * 60}
            duration={metric.label.includes("Balance") ? "slow" : "normal"}
            className="min-w-0 px-6 text-center first:pl-0 last:pr-0"
          >
            <div className="font-mono text-[14px] font-medium text-[#B8B8B8]">{metric.label}</div>
            <div className="mt-2 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
              <span className="font-mono text-[24px] font-bold leading-none text-white tabular-nums">{metric.value}</span>
              {metric.unit ? <span className="font-mono text-[13px] text-[#B8B8B8]">{metric.unit}</span> : null}
              {metric.delta ? (
                <span
                  className={cx(
                    "font-mono text-[14px] font-bold tabular-nums",
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
      <ViewportReveal variant="expand" delay={160} duration="slow" className="mt-4 h-px w-full bg-[#1A1A1A]" />
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
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ViewportReveal
        variant="fade"
        delay={120}
        duration="normal"
        className="relative min-h-0 flex-1 border-b border-[#2A2A2A] bg-black/30"
      >
        <div className="absolute inset-0 flex flex-col">
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
          <div className="relative min-h-0 flex-1">
            <TimezoneMenu />
            <ChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            <div className="absolute inset-0 p-2">
              <PortfolioChart data={view.mobileChartData} variant="mobile" />
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
          <div className="col-span-1 flex flex-col border-r border-[#2A2A2A]">
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

// Guide is desktop-only; mobile bar uses the logo as Home.
const mobileNavSideItems = {
  left: [dashboardNavItems[1]!, dashboardNavItems[2]!],
  center: dashboardNavItems[0]!,
  right: [dashboardNavItems[3]!, dashboardNavItems[4]!],
} as const;

function MobileNavItemButton({
  item,
  active,
  onNavigate,
}: {
  item: (typeof dashboardNavItems)[number];
  active: boolean;
  onNavigate: (section: DashboardSection) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.section)}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={cx(
        "relative flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 transition-colors",
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
  const logoActive = mobileNavSideItems.center.section === activeSection;

  return (
    <nav
      className="relative z-40 h-[52px] shrink-0 border-t border-[#1A1A2A] bg-black/75 backdrop-blur-sm"
      aria-label="Mobile navigation"
    >
      <div className="flex h-full w-full items-center justify-between px-1">
        <div className="flex flex-1 items-center justify-evenly">
          {mobileNavSideItems.left.map((item) => (
            <MobileNavItemButton
              key={item.section}
              item={item}
              active={item.section === activeSection}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onNavigate(mobileNavSideItems.center.section)}
          aria-current={logoActive ? "page" : undefined}
          aria-label={mobileNavSideItems.center.label}
          className={cx(
            "relative flex h-full min-w-[56px] items-center justify-center px-2 transition-opacity",
            logoActive ? "opacity-100" : "opacity-70 active:opacity-100",
          )}
        >
          {logoActive ? (
            <span className="absolute top-0 h-0.5 w-5 rounded-full bg-white" aria-hidden="true" />
          ) : null}
          <BrandMark variant="rail" />
        </button>
        <div className="flex flex-1 items-center justify-evenly">
          {mobileNavSideItems.right.map((item) => (
            <MobileNavItemButton
              key={item.section}
              item={item}
              active={item.section === activeSection}
              onNavigate={onNavigate}
            />
          ))}
        </div>
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
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
                compact
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
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  return (
    <ChartTimeZoneProvider>
      <div className="flex min-h-dvh flex-1 flex-col">
        <MobileDashboard
          view={view}
          activeSection={activeSection}
          onNavigate={setActiveSection}
          data={data}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          sectionTransitionEnabled={!isDesktop}
        />
        <DesktopDashboard
          view={view}
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
