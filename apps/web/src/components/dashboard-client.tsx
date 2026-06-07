"use client";

import {
  Fragment,
  type ReactNode,
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
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Download,
  ExternalLink,
  Filter,
  Github,
  Home,
  Layers,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { DecisionAlgorithmPanel } from "@/components/decision-algorithm-panel";
import {
  ViewportReveal,
  activityCellDelay,
  activityColumnVariant,
  activityLeadEventVariant,
  activityReferenceVariant,
  activityStatusVariant,
  type ActivityFeedMode,
  homeMetricDelay,
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
import { TokenIcon } from "@/components/token-icon";
import {
  agentModeLabel,
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
  detailsFromDecision,
  detailsFromExecution,
  detailsFromMovement,
  type LogEventDetails,
} from "@/lib/log-event-details";
import { statusSchema, type StatusPayload } from "@/lib/schemas";

type DashboardSection = "overview" | "positions" | "activity" | "wallet" | "algorithm";
type ActivityView = "txs" | "sys";

const navItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Active Positions", icon: Layers, section: "positions" },
  { label: "Activity", icon: Activity, section: "activity" },
  { label: "Wallet", icon: Wallet, section: "wallet" },
  { label: "How It Works", icon: BrainCircuit, section: "algorithm" },
];

const mobileNavItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Home", icon: Home, section: "overview" },
  { label: "Positions", icon: Layers, section: "positions" },
  { label: "Activity", icon: Activity, section: "activity" },
  { label: "Wallet", icon: Wallet, section: "wallet" },
  { label: "Guide", icon: BookOpen, section: "algorithm" },
];

const MOBILE_NAV_HEIGHT = 52;

const projectRepository = {
  owner: "AlejoReyna",
  name: "no-named-yet-bot",
  url: "https://github.com/AlejoReyna/ultraSecretYetPublicProject/tree/main/no-named-yet-bot",
  title: "No Named Yet Bot",
  description: "Autonomous trading bot with TWAK signing, CMC data, and strict guardrails.",
};

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
  hash: string;
  explorerUrl: string | null;
  status: string;
  tone: "green" | "yellow" | "red";
  details?: LogEventDetails;
};

type PositionRow = {
  id: string;
  symbol: string;
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

function AsciiRaccoonWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[min(240px,28vh)] w-[min(240px,44vw)] -translate-x-1/2 -translate-y-1/2 bg-[url(/ascii-raccoon.png)] bg-contain bg-center bg-no-repeat opacity-20 mix-blend-screen lg:h-[min(520px,58vh)] lg:w-[min(520px,78vw)] lg:opacity-35"
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
  }, [enabled, section]);

  useEffect(() => {
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

function pnlFromWindow(values: number[]) {
  if (values.length < 2) {
    return { absolute: null, percent: null };
  }

  const first = values[0];
  const last = values.at(-1) ?? first;
  const absolute = last - first;
  const percent = first !== 0 ? (absolute / first) * 100 : null;

  return { absolute, percent };
}

function chartPoints(data: StatusPayload | null, range: TimeRange): PortfolioChartPoint[] {
  const decisions = decisionsForRange(data, range);
  const points = decisions
    .filter((decision) => typeof decision.portfolio_value_usdc === "number")
    .map((decision, index) => ({
      label: decision.cycle_number ? `#${decision.cycle_number}` : `${index + 1}`,
      value: decision.portfolio_value_usdc ?? 0,
    }));

  if (points.length > 0) {
    return points;
  }

  const fallback = latestPortfolioValue(data) ?? 0;
  return [
    { label: "1", value: fallback },
    { label: "2", value: fallback },
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

function activityFromTelemetry(data: StatusPayload | null): ActivityRow[] {
  const movements =
    data?.wallet.movements.slice(0, 7).map((movement, index) => {
      const failed = Boolean(movement.error) || String(movement.status ?? "").toLowerCase().includes("failed");
      const pending = !movement.txHash && !failed;

      return {
        id: `movement-${movement.txHash ?? movement.timestamp ?? index}`,
        amount: amountLabel(movement),
        hash: shortHash(movement.txHash),
        explorerUrl: movement.explorerUrl ?? explorerUrlFor(movement.chain, movement.txHash),
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
  return (data?.positions.positions ?? [])
    .filter((position) => {
      const amount = position.amount_tokens;
      return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
    })
    .map((position, index) => ({
      id: `position-${position.symbol}-${position.opened_at ?? index}`,
      symbol: position.symbol,
      amount: position.amount_tokens ?? null,
      entryPrice: position.entry_price ?? null,
      entryValueUsd: position.entry_value_usdc ?? null,
      highestPrice: position.highest_price ?? null,
      trailingStopPrice: position.trailing_stop_price ?? null,
      takeProfitPrice: position.take_profit_price ?? null,
      openedAt: position.opened_at ?? null,
    }));
}

function buildViewModel(
  data: StatusPayload | null,
  error: string | null,
  timeRange: TimeRange,
): DashboardViewModel {
  const rangedDecisions = decisionsForRange(data, timeRange);
  const values = numericPortfolioValues(rangedDecisions);
  const latest = latestPortfolioValue(data);
  const pnl = pnlFromWindow(values);
  const pnlTone = (pnl.absolute ?? 0) >= 0 ? "positive" : "negative";
  const activeTrades = realActiveTradeCount(data);
  const successRate = executionSuccessRate(data?.executions ?? []);
  const chart = chartPoints(data, timeRange);
  const performanceDelta =
    pnl.absolute !== null && pnl.absolute !== 0 ? formatPercent(pnl.percent) : undefined;
  const positionRows = activePositionRowsFromTelemetry(data);
  const totalPositionValue = positionRows.reduce((sum, row) => sum + (row.entryValueUsd ?? 0), 0);

  return {
    metrics: [
      {
        label: "Total Balance",
        value: formatUsd(latest),
        unit: typeof latest === "number" ? "USD" : undefined,
        delta: performanceDelta,
        tone: pnlTone,
        tooltip: "Live TWAK portfolio total when available; otherwise latest strategy portfolio value.",
      },
      {
        label: "Window Profit/Loss",
        value: formatSignedUsd(pnl.absolute),
        delta: performanceDelta,
        tone: pnlTone,
        tooltip: "Portfolio movement across the decision window currently returned by the exporter.",
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
    pnlDelta: performanceDelta,
    pnlTone,
  };
}

function TooltipLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  if (!tooltip) {
    return <span>{label}</span>;
  }

  return (
    <span className="group relative inline-flex cursor-help items-center">
      <span>{label}</span>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-64 border border-[#1A1A1A] bg-[#050505] px-3 py-2 text-left font-mono text-[11px] leading-5 text-white shadow-[0_18px_46px_rgba(0,0,0,0.72)] group-hover:block">
        {tooltip}
      </span>
    </span>
  );
}

function PythonLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        fill="#3776AB"
        d="M15.9 3.2c-5.7 0-5.4 2.5-5.4 2.5v2.6h5.5v.8H8.4S4 8.6 4 15.4c0 6.8 3.8 6.6 3.8 6.6h2.3v-3.2s-.1-3.8 3.7-3.8h5.5s3.1.1 3.1-3V6.8s.5-3.6-6.5-3.6Zm-3 2.2c.6 0 1 .5 1 1s-.5 1-1 1a1 1 0 1 1 0-2Z"
      />
      <path
        fill="#FFD43B"
        d="M16.1 28.8c5.7 0 5.4-2.5 5.4-2.5v-2.6H16v-.8h7.6s4.4.5 4.4-6.3c0-6.8-3.8-6.6-3.8-6.6h-2.3v3.2s.1 3.8-3.7 3.8h-5.5s-3.1-.1-3.1 3v5.2s-.5 3.6 6.5 3.6Zm3-2.2c-.6 0-1-.5-1-1s.5-1 1-1a1 1 0 1 1 0 2Z"
      />
    </svg>
  );
}

function GithubRepositoryCard({ variant = "default" }: { variant?: "default" | "compact" }) {
  const compact = variant === "compact";

  return (
    <a
      href={projectRepository.url}
      target="_blank"
      rel="noreferrer"
      className="group block w-full border-0 bg-[#070707] text-left transition-colors hover:bg-[#0B0B0B]"
      aria-label="Open cascade-ai project on GitHub"
    >
        <span className={cx("flex min-w-0 justify-between", compact ? "items-center gap-2" : "items-start gap-3")}>
          <span className={cx("flex min-w-0 items-center", compact ? "gap-2" : "gap-2.5")}>
            <Github size={compact ? 13 : 16} className="shrink-0 text-white" />
            <span className="min-w-0">
              <span
                className={cx(
                  "block truncate font-mono uppercase tracking-[0.18em] text-[#777777]",
                  compact ? "text-[9px] leading-3" : "text-[10px] leading-4",
                )}
              >
                {projectRepository.owner}
              </span>
              <span className={cx("block truncate font-semibold text-[#F2F2F2]", compact ? "text-xs leading-4" : "text-sm leading-5")}>
                {projectRepository.name}
              </span>
            </span>
          </span>
          <ExternalLink
            size={compact ? 12 : 14}
            className="shrink-0 text-[#8A8A8A] transition-colors group-hover:text-white"
          />
        </span>
        {!compact ? (
          <span className="mt-2 block border-t border-[#1A1A1A] pt-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#A8A8A8]">
              <PythonLogo className="h-3 w-3 shrink-0" />
              Python
            </span>
            <span className="mt-2 block overflow-hidden text-xs leading-5 text-[#BDBDBD] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
              {projectRepository.description}
            </span>
          </span>
        ) : null}
    </a>
  );
}

function DesktopSidebar({
  activeSection,
  onNavigate,
}: {
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
}) {
  return (
    <aside className="relative z-[1] flex min-h-screen w-[280px] shrink-0 flex-col border-r border-[#1A1A1A] bg-[#050505] 2xl:w-[320px]">
      <div className="border-b border-[#1A1A1A] px-4 py-4">
        <GithubRepositoryCard />
      </div>
      <nav className="grid gap-1 px-4 py-5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.section === activeSection;

          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.section)}
              className={cx(
                "group flex h-12 w-full items-center gap-3 border border-transparent px-3 font-mono text-[13px] transition-colors",
                active
                  ? "border-[#1A1A1A] bg-[#0D1A12] text-white shadow-[inset_3px_0_0_#00FF00]"
                  : "text-[#C9C9C9] hover:border-[#1A1A1A] hover:bg-[#0A0A0A] hover:text-white",
              )}
            >
              <Icon
                size={17}
                className={cx("shrink-0", active ? "text-[#00FF00]" : "text-[#A3A3A3] group-hover:text-white")}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto px-4 py-4">
        <button className="flex h-12 w-full items-center gap-3 border border-[#333333] bg-[#171717] px-3 font-mono text-[13px] text-white transition-colors hover:border-[#4A4A4A] hover:bg-[#202020]">
          <Download size={17} className="shrink-0 text-[#A3A3A3]" />
          <span>Export CSV</span>
        </button>
      </div>
      <div className="border-t border-[#1A1A1A] px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center border border-[#2A2A2A] bg-[#0A0A0A] text-[#D8D8D8]">
            <CircleUserRound size={19} />
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-[#777777]">Trader Profile</span>
            <span className="block truncate text-sm font-medium text-white">A. Reyna</span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function DesktopMetricBlock({
  label,
  value,
  unit,
  delta,
  tone,
  tooltip,
  index = 0,
}: MetricView & { index?: number }) {
  return (
    <ViewportReveal
      variant={homeMetricVariant(label, tone)}
      delay={homeMetricDelay(index)}
      duration={label.includes("Balance") ? "slow" : "normal"}
      className="min-w-0"
    >
      <div className="min-w-0 border border-[#2A2A2A] bg-black/88 px-5 py-4">
        <ViewportReveal variant="fade" delay={homeMetricDelay(index) + 40} duration="fast">
          <div className="mb-3 font-mono text-[13px] text-[#A0A0A0]">
            <TooltipLabel label={label} tooltip={tooltip} />
          </div>
        </ViewportReveal>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="break-words font-mono text-[30px] font-semibold leading-none text-white tabular-nums">{value}</span>
          {unit ? <span className="font-mono text-sm font-semibold text-[#C7C7C7]">{unit}</span> : null}
          {delta ? (
            <span
              className={cx(
                "font-mono text-sm font-semibold tabular-nums",
                tone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]",
              )}
            >
              {delta}
            </span>
          ) : null}
        </div>
      </div>
    </ViewportReveal>
  );
}

function TimeRangeSelector({
  compact = false,
  value,
  onChange,
  animated = false,
}: {
  compact?: boolean;
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  animated?: boolean;
}) {
  const buttons = timeRanges.map((range, index) => (
    <button
      key={range}
      type="button"
      onClick={() => onChange(range)}
      className={cx(
        "border font-mono transition-colors",
        compact ? "h-7 min-w-8 px-2 text-[10px]" : "h-8 min-w-10 px-3 text-xs",
        range === value
          ? "border-[#666666] bg-[#222222] text-white"
          : "border-[#242424] bg-[#101010] text-[#A8A8A8] hover:border-[#3A3A3A] hover:text-white",
      )}
    >
      {range}
    </button>
  ));

  if (!animated) {
    return <div className={cx("flex items-center", compact ? "gap-1.5" : "gap-2")}>{buttons}</div>;
  }

  return (
    <ViewportReveal variant="fade" delay={200} duration="fast">
      <div className={cx("flex items-center", compact ? "gap-1.5" : "gap-2")}>
        {timeRanges.map((range, index) => (
          <ViewportReveal key={range} variant="up" delay={240 + index * 35} duration="fast">
            <button
              type="button"
              onClick={() => onChange(range)}
              className={cx(
                "border font-mono transition-colors",
                compact ? "h-7 min-w-8 px-2 text-[10px]" : "h-8 min-w-10 px-3 text-xs",
                range === value
                  ? "border-[#666666] bg-[#222222] text-white"
                  : "border-[#242424] bg-[#101010] text-[#A8A8A8] hover:border-[#3A3A3A] hover:text-white",
              )}
            >
              {range}
            </button>
          </ViewportReveal>
        ))}
      </div>
    </ViewportReveal>
  );
}

function DesktopPerformancePanel({
  view,
  timeRange,
  onTimeRangeChange,
}: {
  view: DashboardViewModel;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col px-10 py-9">
      <ViewportReveal variant="blur" duration="slow" className="mb-9">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Overview</div>
          <h1 className="mt-2 font-mono text-[32px] font-semibold leading-tight text-white">Alexis' terminal</h1>
        </div>
        <ViewportReveal variant="expand" delay={120} duration="slow" className="mt-4 h-px w-full bg-[#1A1A1A]" />
      </ViewportReveal>
      <div className="grid grid-cols-4 gap-4">
        {view.metrics.map((metric, index) => (
          <DesktopMetricBlock key={metric.label} {...metric} index={index} />
        ))}
      </div>
      <ViewportReveal variant="fade" delay={360} duration="slow" className="mt-10 flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col border border-[#2A2A2A] bg-black/80">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1A1A1A] px-7 py-5">
            <ViewportReveal variant="left" delay={400} duration="fast">
              <h2 className="font-mono text-lg text-[#CFCFCF]">Portfolio Chart</h2>
            </ViewportReveal>
            <TimeRangeSelector value={timeRange} onChange={onTimeRangeChange} animated />
          </div>
          <ViewportReveal variant="blur" delay={480} duration="slow" className="min-h-[340px] flex-1 p-6">
            <PortfolioChart data={view.chartData} variant="desktop" />
          </ViewportReveal>
        </div>
      </ViewportReveal>
    </section>
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

function decisionAccentClass(tone: "green" | "yellow" | "red") {
  if (tone === "green") {
    return "border-l-[#00FF66]/70";
  }

  if (tone === "red") {
    return "border-l-[#FF3737]/70";
  }

  return "border-l-[#FFD21A]/70";
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
}: {
  balances: WalletBalanceRow[];
  agentMode: string;
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const paperMode = agentMode === "PAPER";
  const totalValue = balances.reduce((sum, balance) => sum + (balance.valueUsd ?? 0), 0);
  const headerPadding = compact ? "px-4 py-4" : "px-5 py-5";

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <section
      className={cx(
        compact ? "flex min-h-0 flex-1 flex-col px-4 pt-4" : "mx-10 my-9 border border-[#2A2A2A] bg-black/88",
      )}
    >
      <div className={cx("border-b border-[#1A1A1A]", headerPadding, compact && "shrink-0")}>
        <div className="flex items-start justify-between gap-4">
          <ViewportReveal variant="blur" duration="slow" className="min-w-0">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">TWAK Wallet</div>
              <h1
                className={cx(
                  "mt-1 font-mono font-semibold leading-tight text-white",
                  compact ? "text-[28px]" : "text-[32px]",
                )}
              >
                Live Holdings
              </h1>
            </div>
          </ViewportReveal>
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
        <ViewportReveal variant="expand" delay={220} duration="slow" className="mt-4 h-px w-full bg-[#1A1A1A]" />
      </div>

      <div
        ref={scrollRef}
        className={cx(
          "console-scroll overflow-x-auto overflow-y-auto",
          compact ? "min-h-0 flex-1" : "max-h-[min(70vh,720px)]",
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
                compact={compact}
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

function ActivityDetailPanel({ details }: { details: LogEventDetails }) {
  return (
    <div className="space-y-4 px-4 py-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {details.items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#757575]">{item.label}</dt>
            <dd className={cx("mt-1 break-words font-mono text-[12px] leading-5", detailValueToneClass(item.tone))}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {details.factors && details.factors.length > 0 ? (
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#757575]">
            Factor scores · all 6 required to enter
          </div>
          <div className="flex flex-wrap gap-2">
            {details.factors.map((factor) => (
              <span
                key={factor.key}
                className={cx(
                  "inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]",
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
  column: "event" | "reference" | "status";
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
  expandable,
  expanded,
  mode,
  scrollRoot,
  onToggle,
}: {
  row: ActivityRow;
  index: number;
  compact: boolean;
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
        <td className={cx("font-mono text-[13px] font-bold text-[#F2F2F2]", compact ? "px-3 py-2" : "px-4 py-5")}>
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
            <span className="truncate">{row.amount}</span>
          </ViewportReveal>
        </td>
        <td className={cx("truncate font-mono text-[12px] text-[#D0D0D0]", compact ? "px-2 py-2" : "px-1 py-5")}>
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
        <td className={cx(compact ? "px-2 py-2" : "px-3 py-4")}>
          <ViewportReveal
            as="span"
            variant={activityStatusVariant(row.tone)}
            delay={activityCellDelay(index, "status")}
            root={scrollRoot}
            className="flex min-w-0 items-center gap-1.5"
          >
            <StatusDot status={row.status} tone={row.tone} />
            <span
              className={cx(
                "truncate font-mono text-[10px] font-bold uppercase tracking-[0.06em]",
                statusToneTextClass(row.tone),
              )}
            >
              {row.status}
            </span>
          </ViewportReveal>
        </td>
      </tr>
      {expanded && row.details ? (
        <tr className="border-b border-[#1A1A1A] bg-[#050505]">
          <td colSpan={3}>
            <ViewportReveal variant="fade" delay={40} duration="fast" root={scrollRoot}>
              <ActivityDetailPanel details={row.details} />
            </ViewportReveal>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function RecentActivity({
  rows,
  compact = false,
  expandable = false,
  mode = "logs",
  scrollRoot = null,
}: {
  rows: ActivityRow[];
  compact?: boolean;
  expandable?: boolean;
  mode?: ActivityFeedMode;
  scrollRoot?: Element | null;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

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
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className={expandable ? "w-[36%]" : "w-[34%]"} />
        <col className="w-[32%]" />
        <col className="w-[32%]" />
      </colgroup>
      <thead
        className={cx(
          "font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]",
          compact ? "border-b border-[#1A1A1A]" : "border-y border-[#1A1A1A]",
        )}
      >
        <tr>
          <ActivityHeaderCell
            column="event"
            label="Event"
            mode={mode}
            expandable={expandable}
            className={cx(compact ? "px-3 py-2" : "px-4 py-4")}
          />
          <ActivityHeaderCell
            column="reference"
            label="Reference"
            mode={mode}
            className={cx(compact ? "px-2 py-2" : "px-1 py-4")}
          />
          <ActivityHeaderCell
            column="status"
            label="Status"
            mode={mode}
            className={cx(compact ? "px-2 py-2" : "px-3 py-4")}
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <ActivityTableRow
            key={row.id}
            row={row}
            index={index}
            compact={compact}
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
              className={cx("font-mono text-[12px] text-[#8A8A8A]", compact ? "px-3 py-4" : "px-4 py-5")}
              colSpan={3}
            >
              <ViewportReveal variant="blur" duration="slow" root={scrollRoot}>
                Waiting for telemetry
              </ViewportReveal>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
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

function ActivePositionsPanel({
  rows,
  totalPositionValue,
  agentMode,
  compact = false,
}: {
  rows: PositionRow[];
  totalPositionValue: string;
  agentMode: string;
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);
  const paperMode = agentMode === "PAPER";

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <section
      className={cx(
        "flex min-h-0 flex-col",
        compact ? "flex-1 px-4 pt-4" : "px-10 py-9",
      )}
    >
      <div className={cx(compact ? "shrink-0 border-b border-[#1A1A1A] pb-4" : "mb-6")}>
        <ViewportReveal variant="blur" duration="slow">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy</div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <h1
              className={cx(
                "font-mono font-semibold leading-tight text-white",
                compact ? "text-[28px]" : "text-[32px]",
              )}
            >
              Active Positions
            </h1>
            {compact ? (
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
            ) : (
              <ViewportReveal variant="scale" delay={90} duration="fast">
                <StatusBadge status={agentMode} tone={paperMode ? "yellow" : "green"} />
              </ViewportReveal>
            )}
          </div>
          {!compact ? (
            <ViewportReveal variant="left" delay={140}>
              <p className="mt-2 max-w-3xl font-mono text-[12px] leading-5 text-[#8A8A8A]">
                Open holdings tracked in `positions.json` on EC2. Entry price, trailing stop, and take-profit levels are
                maintained by the agent after each decision cycle.
              </p>
            </ViewportReveal>
          ) : null}
        </ViewportReveal>
        {!compact ? (
          <ViewportReveal variant="expand" delay={180} duration="slow" className="mt-4 h-px w-full bg-[#1A1A1A]" />
        ) : null}
      </div>

      {!compact ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <ViewportReveal variant="fade" delay={100}>
            <div className="border border-[#2A2A2A] bg-black/88 px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Open positions</div>
              <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums text-white">{rows.length}</div>
            </div>
          </ViewportReveal>
          <ViewportReveal variant="scale" delay={160} duration="slow">
            <div className="border border-[#2A2A2A] bg-black/88 px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Total entry value</div>
              <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums text-white">{totalPositionValue}</div>
            </div>
          </ViewportReveal>
        </div>
      ) : null}

      {!compact ? (
        <ViewportReveal variant="fade" delay={200}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div className="border-b border-[#1A1A1A] px-5 py-5">
              <ViewportReveal variant="left" delay={240} duration="fast">
                <h2 className="font-mono text-xl text-[#DADADA]">Position Book</h2>
              </ViewportReveal>
            </div>
            <div ref={scrollRef} className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
              <ActivePositionsTable rows={rows} compact={compact} scrollRoot={scrollRoot} />
            </div>
          </div>
        </ViewportReveal>
      ) : (
        <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <ActivePositionsTable rows={rows} compact={compact} scrollRoot={scrollRoot} />
        </div>
      )}
    </section>
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
  latestDecision,
  agentRunning,
  compact = false,
}: {
  rows: ActivityRow[];
  agentLog: ReturnType<typeof resolveAgentLogLine>;
  latestDecision: StatusPayload["latestDecision"];
  agentRunning: boolean;
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <div className={cx(compact && "flex min-h-0 flex-1 flex-col")}>
      {agentLog.line ? (
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
              <p className="break-words font-mono text-[12px] leading-5 text-[#DADADA]">{agentLog.line}</p>
            </ViewportReveal>
            <ViewportReveal variant="scale" delay={180} duration="fast" className="mt-3">
              <StatusBadge status={agentRunning ? "RUNNING" : "OFFLINE"} tone={agentRunning ? "green" : "red"} />
            </ViewportReveal>
          </div>
        </ViewportReveal>
      ) : latestDecision ? (
        <ViewportReveal variant="scale" duration="slow" className={cx(compact ? "mb-4 shrink-0" : "mb-6")}>
          <div
            className={cx(
              "border border-[#2A2A2A] border-l-2 bg-black/88",
              decisionAccentClass(decisionActionTone(latestDecision.action)),
              compact ? "px-4 py-4" : "px-5 py-4",
            )}
          >
            <ViewportReveal variant="fade" delay={50} duration="fast">
              <div className="mb-2 flex items-center gap-2">
                <StatusDot status={latestDecision.action} tone={decisionActionTone(latestDecision.action)} />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">
                  Latest decision
                  {latestDecision.cycle_number != null ? ` · cycle #${latestDecision.cycle_number}` : ""}
                </span>
              </div>
            </ViewportReveal>
            <ViewportReveal variant="left" delay={110}>
              <p className="break-words font-mono text-[12px] leading-5 text-[#DADADA]">
                {formatDecisionEvent(latestDecision)}
              </p>
            </ViewportReveal>
          </div>
        </ViewportReveal>
      ) : null}

      {compact ? (
        <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <RecentActivity rows={rows} expandable compact mode="logs" scrollRoot={scrollRoot} />
        </div>
      ) : (
        <ViewportReveal variant="fade" delay={80}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div className="border-b border-[#1A1A1A] px-5 py-5">
              <ViewportReveal variant="left" delay={120} duration="fast">
                <h2 className="font-mono text-xl text-[#DADADA]">Decision &amp; Execution Log</h2>
              </ViewportReveal>
            </div>
            <div ref={scrollRef} className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
              <RecentActivity rows={rows} expandable mode="logs" scrollRoot={scrollRoot} />
            </div>
          </div>
        </ViewportReveal>
      )}
    </div>
  );
}

function TxActivityPanel({
  rows,
  compact = false,
}: {
  rows: ActivityRow[];
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<Element | null>(null);

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  return (
    <div className={cx("flex min-h-0 flex-1 flex-col", !compact && "gap-0")}>
      {!compact ? (
        <ViewportReveal variant="right" delay={60} duration="fast" className="mb-6 max-w-3xl">
          <p className="font-mono text-[12px] leading-5 text-[#8A8A8A]">
            On-chain swaps and execution events from TWAK portfolio telemetry.
          </p>
        </ViewportReveal>
      ) : null}

      {compact ? (
        <div ref={scrollRef} className="console-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <RecentActivity rows={rows} expandable compact mode="txs" scrollRoot={scrollRoot} />
        </div>
      ) : (
        <ViewportReveal variant="fade" delay={100}>
          <div className="border border-[#2A2A2A] bg-black/88">
            <div className="border-b border-[#1A1A1A] px-5 py-5">
              <ViewportReveal variant="right" delay={140} duration="fast">
                <h2 className="font-mono text-xl text-[#DADADA]">Recent Activity</h2>
              </ViewportReveal>
            </div>
            <div ref={scrollRef} className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
              <RecentActivity rows={rows} expandable mode="txs" scrollRoot={scrollRoot} />
            </div>
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
  agentRunning,
  compact = false,
}: {
  activityRows: ActivityRow[];
  logRows: ActivityRow[];
  agentLog: ReturnType<typeof resolveAgentLogLine>;
  latestDecision: StatusPayload["latestDecision"];
  agentRunning: boolean;
  compact?: boolean;
}) {
  const [view, setView] = useState<ActivityView>("sys");

  return (
    <section
      className={cx(
        "flex min-h-0 flex-col",
        compact ? "flex-1 px-4 pt-4" : "px-10 py-9",
      )}
    >
      <div
        className={cx(
          "flex justify-between gap-4",
          compact ? "shrink-0 items-end border-b border-[#1A1A1A] pb-3" : "mb-6 items-start",
        )}
      >
        <ViewportReveal variant="blur" duration="slow" className="min-w-0">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Telemetry</div>
            <h1
              className={cx(
                "mt-2 font-mono font-semibold leading-tight text-white",
                compact ? "text-[28px]" : "text-[32px]",
              )}
            >
              Activity
            </h1>
          </div>
        </ViewportReveal>
        <ActivityTabSelector value={view} onChange={setView} compact={compact} />
      </div>

      {!compact ? (
        <ViewportReveal variant="expand" delay={160} duration="slow" className="mb-4 h-px bg-[#1A1A1A]" />
      ) : null}

      <ActivityViewTransition view={view} className="flex min-h-0 flex-1 flex-col">
        {(activeView) =>
          activeView === "txs" ? (
            <TxActivityPanel rows={activityRows} compact={compact} />
          ) : (
            <SysLogsPanel
              rows={logRows}
              agentLog={agentLog}
              latestDecision={latestDecision}
              agentRunning={agentRunning}
              compact={compact}
            />
          )
        }
      </ActivityViewTransition>
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
    <div className="relative isolate hidden min-h-screen bg-black text-white lg:flex">
      <AsciiRaccoonWatermark />
      <DesktopSidebar activeSection={activeSection} onNavigate={onNavigate} />
      <main className="relative z-[1] technical-grid min-w-0 flex-1">
        {view.telemetryError ? <TelemetryBanner message={view.telemetryError} /> : null}
        <SectionTransition section={activeSection} enabled={sectionTransitionEnabled}>
          {(section) =>
            section === "activity" ? (
              <ActivityPanel
                activityRows={view.activityRows}
                logRows={view.logRows}
                agentLog={resolveAgentLogLine(data)}
                latestDecision={data?.latestDecision ?? null}
                agentRunning={Boolean(data?.health.agentRunning)}
              />
            ) : section === "wallet" ? (
              <WalletPanel balances={view.walletBalances} agentMode={view.agentMode} />
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
              />
            ) : section === "algorithm" ? (
              <DecisionAlgorithmPanel latestDecision={data?.latestDecision ?? null} />
            ) : (
              <section className="h-[calc(100vh-36px)] min-h-0">
                <DesktopPerformancePanel view={view} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
              </section>
            )
          }
        </SectionTransition>
      </main>
    </div>
  );
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#1A1A1A] bg-[#050505]">
      <div className="mx-auto max-w-[640px] px-4 py-2">
        <GithubRepositoryCard variant="compact" />
      </div>
    </header>
  );
}

function MobileHeroMetrics({ view }: { view: DashboardViewModel }) {
  return (
    <section className="shrink-0 px-4 pt-4">
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
      <ViewportReveal variant="expand" delay={160} duration="slow" className="mt-4 h-px w-full bg-[#1A1A1A]" />
    </section>
  );
}

function MobileChartFilterMenu({
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

function MobilePerformanceWidget({
  view,
  timeRange,
  onTimeRangeChange,
}: {
  view: DashboardViewModel;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  return (
    <ViewportReveal variant="fade" delay={200} duration="slow" className="mx-4 mt-3 flex min-h-0 flex-1 flex-col">
      <section className="flex min-h-0 flex-1 flex-col border border-[#2A2A2A] bg-black/80">
        <div className="relative min-h-0 flex-1">
          <MobileChartFilterMenu timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
          <ViewportReveal variant="blur" delay={320} duration="slow" className="absolute inset-0 flex flex-col px-2 py-2">
            <PortfolioChart data={view.mobileChartData} variant="mobile" />
          </ViewportReveal>
        </div>
      </section>
    </ViewportReveal>
  );
}

function MobileBottomNav({
  activeSection,
  onNavigate,
}: {
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
}) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#1A1A1A] bg-[#050505]/95 backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Mobile navigation"
    >
      <div
        className="mx-auto grid max-w-[640px] grid-cols-5 px-0.5"
        style={{ height: MOBILE_NAV_HEIGHT }}
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = item.section === activeSection;

          return (
            <button
              key={item.section}
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
              <span className="max-w-full truncate font-mono text-[9px] font-semibold uppercase tracking-[0.06em]">
                {item.label}
              </span>
            </button>
          );
        })}
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
  return (
    <div className="technical-grid relative isolate flex min-h-dvh flex-col bg-black text-white lg:hidden">
      <AsciiRaccoonWatermark />
      {/* <MobileHeader /> */}
      {view.telemetryError ? <TelemetryBanner message={view.telemetryError} /> : null}
      <main
        className="relative z-[1] mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col"
        style={{ paddingBottom: `calc(${MOBILE_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px) + 16px)` }}
      >
        <SectionTransition
          section={activeSection}
          enabled={sectionTransitionEnabled}
          className="flex min-h-0 flex-1 flex-col"
        >
          {(section) =>
            section === "activity" ? (
              <ActivityPanel
                activityRows={view.activityRows}
                logRows={view.logRows}
                agentLog={resolveAgentLogLine(data)}
                latestDecision={data?.latestDecision ?? null}
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
            ) : (
              <section className="flex min-h-0 flex-1 flex-col">
                <MobileHeroMetrics view={view} />
                <MobilePerformanceWidget view={view} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
              </section>
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
    <>
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
    </>
  );
}
