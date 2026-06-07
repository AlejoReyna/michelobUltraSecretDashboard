"use client";

import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Download,
  ExternalLink,
  FileText,
  Github,
  Home,
  Layers,
  LineChart,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { DecisionAlgorithmPanel } from "@/components/decision-algorithm-panel";
import { PortfolioChart, type PortfolioChartPoint } from "@/components/portfolio-chart";
import { TokenIcon } from "@/components/token-icon";
import {
  agentModeLabel,
  liveWalletBalancesFromTelemetry,
  realActiveTradeCount,
  type WalletBalanceRow,
} from "@/lib/competition-tokens";
import { decisionActionTone, formatDecisionLogLine, resolveAgentLogLine } from "@/lib/agent-log";
import { decisionFactorSummary } from "@/lib/factor-scoring";
import {
  detailsFromDecision,
  detailsFromExecution,
  detailsFromMovement,
  type LogEventDetails,
} from "@/lib/log-event-details";
import { statusSchema, type StatusPayload } from "@/lib/schemas";

type DashboardSection = "overview" | "positions" | "logs" | "chart" | "algorithm";

const navItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Active Positions", icon: Layers, section: "positions" },
  { label: "Logs", icon: FileText, section: "logs" },
  { label: "How It Works", icon: BrainCircuit, section: "algorithm" },
];

const mobileNavItems: Array<{ label: string; icon: LucideIcon; section: DashboardSection }> = [
  { label: "Home", icon: Home, section: "overview" },
  { label: "Positions", icon: Layers, section: "positions" },
  { label: "Logs", icon: ScrollText, section: "logs" },
  { label: "Chart", icon: LineChart, section: "chart" },
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

type SystemView = {
  label: string;
  tone: "green" | "yellow" | "red";
  latency: string;
  cycle: string;
  mode: string;
};

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
  pnlDelta: string;
  pnlTone: "positive" | "negative";
  system: SystemView;
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
      className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[min(520px,58vh)] w-[min(520px,78vw)] -translate-x-1/2 -translate-y-1/2 bg-[url(/ascii-raccoon.png)] bg-contain bg-center bg-no-repeat opacity-45 mix-blend-screen"
    />
  );
}

function SectionTransition({
  section,
  children,
  className,
}: {
  section: DashboardSection;
  children: (section: DashboardSection) => ReactNode;
  className?: string;
}) {
  const [displayedSection, setDisplayedSection] = useState(section);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");

  useEffect(() => {
    if (section === displayedSection) {
      return;
    }

    setPhase("out");

    const swapTimeout = window.setTimeout(() => {
      setDisplayedSection(section);
      setPhase("in");
    }, 180);

    const idleTimeout = window.setTimeout(() => {
      setPhase("idle");
    }, 560);

    return () => {
      window.clearTimeout(swapTimeout);
      window.clearTimeout(idleTimeout);
    };
  }, [section, displayedSection]);

  return (
    <div
      className={cx(
        phase === "out" && "section-fade-out",
        (phase === "in" || phase === "idle") && "section-fade-in",
        className,
      )}
    >
      {children(displayedSection)}
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
        const symbol = decision.symbol ?? "strategy";
        const reason = decision.reason ? ` - ${decision.reason}` : "";
        const event = `${action} ${symbol}${reason}`;

        return {
          id: `decision-${decision.cycle_number ?? decision.timestamp ?? index}`,
          amount: event,
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
        const symbol = decision.symbol ?? "strategy";
        const reason = decision.reason ? ` — ${decision.reason}` : "";
        const factors = decision.factor_scores ? ` (${decisionFactorSummary(decision)})` : "";

        return {
          id: `decision-${decision.cycle_number ?? decision.timestamp ?? index}`,
          amount: `${action} ${symbol}${factors}${reason}`,
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

function systemView(data: StatusPayload | null, error: string | null, latencyMs: number | null): SystemView {
  if (error || data?.connection?.source === "error") {
    return {
      label: "Telemetry degraded",
      tone: "yellow",
      latency: latencyMs === null ? "N/A" : `${latencyMs}ms`,
      cycle: "N/A",
      mode: "N/A",
    };
  }

  const running = data?.health.agentRunning;

  return {
    label: running ? "System operational" : "Agent offline",
    tone: running ? "green" : "red",
    latency: latencyMs === null ? "N/A" : `${latencyMs}ms`,
    cycle: data?.latestDecision?.cycle_number ? String(data.latestDecision.cycle_number) : "N/A",
    mode: data?.latestDecision?.mode?.toUpperCase() ?? "N/A",
  };
}

function buildViewModel(
  data: StatusPayload | null,
  error: string | null,
  latencyMs: number | null,
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
  const performanceDelta = formatPercent(pnl.percent);
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
    system: systemView(data, error, latencyMs),
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
        {compact ? (
          <span className="mt-2 flex min-w-0 items-center gap-2 border-t border-[#1A1A1A] pt-2">
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[8px] uppercase tracking-[0.18em] text-[#A8A8A8]">
              <PythonLogo className="h-2.5 w-2.5 shrink-0" />
              Python
            </span>
            <span className="min-w-0 truncate text-[10px] leading-4 text-[#BDBDBD]">{projectRepository.description}</span>
          </span>
        ) : (
          <span className="mt-2 block border-t border-[#1A1A1A] pt-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#A8A8A8]">
              <PythonLogo className="h-3 w-3 shrink-0" />
              Python
            </span>
            <span className="mt-2 block overflow-hidden text-xs leading-5 text-[#BDBDBD] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
              {projectRepository.description}
            </span>
          </span>
        )}
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
    <aside className="flex min-h-screen w-[280px] shrink-0 flex-col border-r border-[#1A1A1A] bg-[#050505] 2xl:w-[320px]">
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

function DesktopMetricBlock({ label, value, unit, delta, tone, tooltip }: MetricView) {
  return (
    <div className="min-w-0 border border-[#2A2A2A] bg-black/88 px-5 py-4">
      <div className="mb-3 font-mono text-[13px] text-[#A0A0A0]">
        <TooltipLabel label={label} tooltip={tooltip} />
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="break-words font-mono text-[30px] font-semibold leading-none text-white tabular-nums">{value}</span>
        {unit ? <span className="font-mono text-sm font-semibold text-[#C7C7C7]">{unit}</span> : null}
        {delta ? (
          <span className={cx("font-mono text-sm font-semibold tabular-nums", tone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]")}>
            {delta}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TimeRangeSelector({
  compact = false,
  value,
  onChange,
}: {
  compact?: boolean;
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  return (
    <div className={cx("flex items-center", compact ? "gap-1.5" : "gap-2")}>
      {timeRanges.map((range) => (
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
      ))}
    </div>
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
      <div className="mb-9">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Overview</div>
        <h1 className="mt-2 font-mono text-[32px] font-semibold leading-tight text-white">Alexis' terminal</h1>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {view.metrics.map((metric) => (
          <DesktopMetricBlock key={metric.label} {...metric} />
        ))}
      </div>
      <div className="mt-10 flex min-h-0 flex-1 flex-col border border-[#2A2A2A] bg-black/80">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1A1A1A] px-7 py-5">
          <h2 className="font-mono text-lg text-[#CFCFCF]">Portfolio Chart</h2>
          <TimeRangeSelector value={timeRange} onChange={onTimeRangeChange} />
        </div>
        <div className="min-h-[340px] flex-1 p-6">
          <PortfolioChart data={view.chartData} variant="desktop" />
        </div>
      </div>
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

function WalletSection({
  balances,
  agentMode,
  compact = false,
  desktopFill = false,
}: {
  balances: WalletBalanceRow[];
  agentMode: string;
  compact?: boolean;
  desktopFill?: boolean;
}) {
  const paperMode = agentMode === "PAPER";

  const headerPadding = desktopFill ? "px-3 py-1.5" : compact ? "px-4 py-4" : "px-5 py-5";
  const sectionPadding = desktopFill ? "px-3 py-1" : compact ? "px-4 py-3" : "px-5 py-3";

  const balancesTable = (
    <div className={cx("min-h-0", desktopFill && "flex flex-1 flex-col border-t border-[#1A1A1A]")}>
      <div className={cx("shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]", sectionPadding)}>
        Balances
      </div>
      <div className={cx(desktopFill && "console-scroll min-h-0 flex-1 overflow-auto")}>
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[22%]" />
          <col className="w-[32%]" />
          <col className="w-[24%]" />
        </colgroup>
        <thead className="border-y border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
          <tr>
            <th className="px-3 py-2">Chain</th>
            <th className="px-2 py-2">Token</th>
            <th className="px-2 py-2">Amount</th>
            <th className="px-3 py-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((balance) => (
            <tr key={`${balance.chain}-${balance.symbol}`} className="border-b border-[#1A1A1A] text-white hover:bg-[#070707]">
              <td className="truncate px-3 py-2 font-mono text-[12px] uppercase text-[#A8A8A8]">{balance.chain}</td>
              <td className="truncate px-2 py-2 font-mono text-[13px] font-bold text-[#F2F2F2]">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <TokenIcon symbol={balance.symbol} size={desktopFill ? 14 : 16} />
                  <span className="truncate">{balance.symbol}</span>
                </span>
              </td>
              <td className="truncate px-2 py-2 font-mono text-[12px] tabular-nums text-[#D0D0D0]">
                {formatTokenAmount(balance.amount)}
              </td>
              <td className="truncate px-3 py-2 text-right font-mono text-[12px] tabular-nums text-[#D0D0D0]">
                {formatUsd(balance.valueUsd)}
              </td>
            </tr>
          ))}
          {balances.length === 0 ? (
            <tr className="border-b border-[#1A1A1A]">
              <td className="px-3 py-4 font-mono text-[12px] text-[#8A8A8A]" colSpan={4}>
                Waiting for TWAK wallet balances
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );

  return (
    <section className={cx(desktopFill ? "flex h-full min-h-0 flex-col bg-black/88" : "border border-[#2A2A2A] bg-black/88")}>
      <div className={cx("shrink-0", !desktopFill && "border-b border-[#1A1A1A]", headerPadding)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">TWAK Wallet</div>
            <h2 className={cx("mt-1 font-mono text-[#DADADA]", compact ? "text-base" : desktopFill ? "text-lg" : "text-xl")}>
              Live Holdings
            </h2>
          </div>
          <StatusBadge status={agentMode} tone={paperMode ? "yellow" : "green"} />
        </div>
        {!desktopFill ? (
          <p className="mt-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">
            {paperMode
              ? "Agent is in paper mode. Below is your real TWAK wallet; CAKE signals are simulated only."
              : "Real token balances from TWAK portfolio telemetry."}
          </p>
        ) : null}
      </div>

      {balancesTable}
    </section>
  );
}

function DesktopWalletPanel({
  balances,
  agentMode,
}: {
  balances: WalletBalanceRow[];
  agentMode: string;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-[#1A1A1A] bg-black/72">
      <WalletSection balances={balances} agentMode={agentMode} desktopFill />
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

function RecentActivity({
  rows,
  compact = false,
  expandable = false,
}: {
  rows: ActivityRow[];
  compact?: boolean;
  expandable?: boolean;
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

  const visibleRows = compact ? rows.slice(0, 4) : rows;

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        {expandable ? <col className="w-[28px]" /> : null}
        <col className={expandable ? "w-[32%]" : "w-[34%]"} />
        <col className={expandable ? "w-[28%]" : "w-[30%]"} />
        <col className={expandable ? "w-[34%]" : "w-[36%]"} />
      </colgroup>
      <thead className="border-y border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
        <tr>
          {expandable ? <th className="px-2 py-4" aria-label="Expand" /> : null}
          <th className="px-4 py-4">Event</th>
          <th className="px-1 py-4">Reference</th>
          <th className="px-4 py-4 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((row) => {
          const canExpand = expandable && Boolean(row.details);
          const isExpanded = canExpand && expandedIds.has(row.id);

          return (
            <Fragment key={row.id}>
              <tr
                className={cx(
                  "border-b border-[#1A1A1A] text-white",
                  canExpand ? "cursor-pointer hover:bg-[#070707]" : "hover:bg-[#070707]",
                )}
                onClick={canExpand ? () => toggleRow(row.id) : undefined}
              >
                {expandable ? (
                  <td className="px-2 py-5 text-[#757575]">
                    {canExpand ? (
                      isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    ) : null}
                  </td>
                ) : null}
                <td className="truncate px-4 py-5 font-mono text-[13px] font-bold tabular-nums">{row.amount}</td>
                <td className="truncate px-1 py-5 font-mono text-[12px] font-bold text-[#D0D0D0]">
                  {row.explorerUrl ? (
                    <a
                      href={row.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#8FD9FF] transition-colors hover:text-white"
                      title={row.explorerUrl}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.hash}
                    </a>
                  ) : (
                    row.hash
                  )}
                </td>
                <td className="px-4 py-4 text-right">
                  <StatusBadge status={row.status} tone={row.tone} />
                </td>
              </tr>
              {isExpanded && row.details ? (
                <tr className="border-b border-[#1A1A1A] bg-[#050505]">
                  <td colSpan={expandable ? 4 : 3}>
                    <ActivityDetailPanel details={row.details} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
        {rows.length === 0 ? (
          <tr className="border-b border-[#1A1A1A]">
            <td className="px-4 py-5 font-mono text-[12px] text-[#8A8A8A]" colSpan={expandable ? 4 : 3}>
              Waiting for telemetry
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function DesktopRecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-black/72">
      <div className="shrink-0 border-b border-[#1A1A1A] px-3 py-2">
        <h2 className="font-mono text-base text-[#DADADA]">Recent Activity</h2>
      </div>
      <div className="console-scroll min-h-0 flex-1 overflow-auto">
        <RecentActivity rows={rows} />
      </div>
    </section>
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

function ActivePositionsTable({ rows, compact = false }: { rows: PositionRow[]; compact?: boolean }) {
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
      <thead className="border-y border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
        <tr>
          <th className={cx("py-4", compact ? "px-3" : "px-5")}>Token</th>
          <th className={cx("py-4", compact ? "px-2" : "px-3")}>Amount</th>
          <th className={cx("py-4", compact ? "px-2" : "px-3")}>Entry</th>
          <th className={cx("py-4", compact ? "px-2" : "px-3")}>Value</th>
          <th className={cx("py-4", compact ? "px-2" : "px-3")}>High</th>
          <th className={cx("py-4", compact ? "px-2" : "px-3")}>Stop</th>
          <th className={cx("py-4", compact ? "px-2" : "px-3")}>Target</th>
          <th className={cx("py-4 text-right", compact ? "px-3" : "px-5")}>Opened</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-[#1A1A1A] text-white hover:bg-[#070707]">
            <td className={cx("py-4 font-mono text-[13px] font-bold text-[#F2F2F2]", compact ? "px-3" : "px-5")}>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <TokenIcon symbol={row.symbol} size={compact ? 14 : 16} />
                <span className="truncate">{row.symbol}</span>
              </span>
            </td>
            <td className={cx("truncate py-4 font-mono text-[12px] tabular-nums text-[#D0D0D0]", compact ? "px-2" : "px-3")}>
              {formatTokenAmount(row.amount)}
            </td>
            <td className={cx("truncate py-4 font-mono text-[12px] tabular-nums text-[#D0D0D0]", compact ? "px-2" : "px-3")}>
              {formatPrice(row.entryPrice)}
            </td>
            <td className={cx("truncate py-4 font-mono text-[12px] tabular-nums text-[#D0D0D0]", compact ? "px-2" : "px-3")}>
              {formatUsd(row.entryValueUsd)}
            </td>
            <td className={cx("truncate py-4 font-mono text-[12px] tabular-nums text-[#00FF66]", compact ? "px-2" : "px-3")}>
              {formatPrice(row.highestPrice)}
            </td>
            <td className={cx("truncate py-4 font-mono text-[12px] tabular-nums text-[#FFD21A]", compact ? "px-2" : "px-3")}>
              {formatPrice(row.trailingStopPrice)}
            </td>
            <td className={cx("truncate py-4 font-mono text-[12px] tabular-nums text-[#8FD9FF]", compact ? "px-2" : "px-3")}>
              {formatPrice(row.takeProfitPrice)}
            </td>
            <td className={cx("truncate py-4 text-right font-mono text-[12px] text-[#A8A8A8]", compact ? "px-3" : "px-5")}>
              {formatOpenedAt(row.openedAt)}
            </td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr className="border-b border-[#1A1A1A]">
            <td className={cx("py-6 font-mono text-[12px] text-[#8A8A8A]", compact ? "px-3" : "px-5")} colSpan={8}>
              No open positions in positions.json
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
  const paperMode = agentMode === "PAPER";

  return (
    <section className={cx("flex min-h-0 flex-col", compact ? "mx-4 mt-9" : "px-10 py-9")}>
      <div className="mb-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy</div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-mono text-[32px] font-semibold leading-tight text-white">Active Positions</h1>
          <StatusBadge status={agentMode} tone={paperMode ? "yellow" : "green"} />
        </div>
        <p className="mt-2 max-w-3xl font-mono text-[12px] leading-5 text-[#8A8A8A]">
          Open holdings tracked in `positions.json` on EC2. Entry price, trailing stop, and take-profit levels are
          maintained by the agent after each decision cycle.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="border border-[#2A2A2A] bg-black/88 px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Open positions</div>
          <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums text-white">{rows.length}</div>
        </div>
        <div className="border border-[#2A2A2A] bg-black/88 px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">Total entry value</div>
          <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums text-white">{totalPositionValue}</div>
        </div>
      </div>

      <div className="border border-[#2A2A2A] bg-black/88">
        <div className="border-b border-[#1A1A1A] px-5 py-5">
          <h2 className="font-mono text-xl text-[#DADADA]">Position Book</h2>
        </div>
        <div className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
          <ActivePositionsTable rows={rows} compact={compact} />
        </div>
      </div>
    </section>
  );
}

function LogsPanel({
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
  return (
    <section className={cx("flex min-h-0 flex-col", compact ? "mx-4 mt-9" : "px-10 py-9")}>
      <div className="mb-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Telemetry</div>
        <h1 className="mt-2 font-mono text-[32px] font-semibold leading-tight text-white">Agent Logs</h1>
        <p className="mt-2 max-w-3xl font-mono text-[12px] leading-5 text-[#8A8A8A]">
          Decision cycles from `decision_log.jsonl` on EC2. When bot stdout is stale, the summary card shows the latest
          decision cycle instead of `bot_live.log` / `agent.log`.
        </p>
      </div>

      {agentLog.line ? (
        <div className="mb-6 border border-[#2A2A2A] bg-black/88 px-5 py-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">
            Latest bot log{agentLog.source ? ` (${agentLog.source})` : ""}
          </div>
          <p className="break-words font-mono text-[12px] leading-5 text-[#DADADA]">{agentLog.line}</p>
          <div className="mt-3">
            <StatusBadge status={agentRunning ? "RUNNING" : "OFFLINE"} tone={agentRunning ? "green" : "red"} />
          </div>
        </div>
      ) : latestDecision ? (
        <div className="mb-6 border border-[#2A2A2A] bg-black/88 px-5 py-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">
            Latest decision
            {latestDecision.cycle_number != null ? ` (cycle #${latestDecision.cycle_number})` : ""}
          </div>
          <p className="break-words font-mono text-[12px] leading-5 text-[#DADADA]">{formatDecisionLogLine(latestDecision)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={latestDecision.action} tone={decisionActionTone(latestDecision.action)} />
            <StatusBadge status={agentRunning ? "RUNNING" : "OFFLINE"} tone={agentRunning ? "green" : "red"} />
          </div>
        </div>
      ) : null}

      <div className="border border-[#2A2A2A] bg-black/88">
        <div className="border-b border-[#1A1A1A] px-5 py-5">
          <h2 className="font-mono text-xl text-[#DADADA]">Decision &amp; Execution Log</h2>
        </div>
        <div className="console-scroll max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto">
          <RecentActivity rows={rows} expandable />
        </div>
      </div>
    </section>
  );
}

function SystemDot({ tone, size = "h-2 w-2" }: { tone: SystemView["tone"]; size?: string }) {
  const classes = {
    green: "bg-[#00FF00] shadow-[0_0_14px_rgba(0,255,0,0.95)]",
    yellow: "bg-[#FFD21A] shadow-[0_0_14px_rgba(255,210,26,0.75)]",
    red: "bg-[#FF3737] shadow-[0_0_14px_rgba(255,55,55,0.75)]",
  }[tone];

  return <span className={cx(size, classes)} />;
}

function DesktopStatusBar({ system }: { system: SystemView }) {
  return (
    <footer className="fixed bottom-0 left-[280px] right-0 z-40 border-t border-[#1A1A1A] bg-[#050505]/95 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#A7A7A7] backdrop-blur 2xl:left-[320px]">
      <div className="flex items-center justify-between gap-6">
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-[#CFCFCF]">
          <SystemDot tone={system.tone} />
          {system.label}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-right">
          <span>
            Latency: <span className="text-white">{system.latency}</span>
          </span>
          <span>
            Cycle: <span className="text-white">{system.cycle}</span>
          </span>
          <span>
            Mode: <span className="text-white">{system.mode}</span>
          </span>
        </span>
      </div>
    </footer>
  );
}

function DesktopDashboard({
  view,
  activeSection,
  onNavigate,
  data,
  timeRange,
  onTimeRangeChange,
}: {
  view: DashboardViewModel;
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
  data: StatusPayload | null;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  return (
    <div className="relative hidden min-h-screen bg-black text-white lg:flex">
      <AsciiRaccoonWatermark />
      <DesktopSidebar activeSection={activeSection} onNavigate={onNavigate} />
      <main className="technical-grid min-w-0 flex-1 pb-9">
        {view.telemetryError ? <TelemetryBanner message={view.telemetryError} /> : null}
        <SectionTransition section={activeSection}>
          {(section) =>
            section === "logs" ? (
              <LogsPanel
                rows={view.logRows}
                agentLog={resolveAgentLogLine(data)}
                latestDecision={data?.latestDecision ?? null}
                agentRunning={Boolean(data?.health.agentRunning)}
              />
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
              />
            ) : section === "algorithm" ? (
              <DecisionAlgorithmPanel latestDecision={data?.latestDecision ?? null} />
            ) : (
              <section className="grid h-[calc(100vh-36px)] min-h-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_280px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
                <DesktopPerformancePanel view={view} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
                <div className="flex h-full min-h-0 flex-col border-l border-[#1A1A1A]">
                  <DesktopWalletPanel balances={view.walletBalances} agentMode={view.agentMode} />
                  <DesktopRecentActivity rows={view.activityRows} />
                </div>
              </section>
            )
          }
        </SectionTransition>
      </main>
      <DesktopStatusBar system={view.system} />
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
    <section className="px-4 pt-5">
      <div className="grid grid-cols-2 gap-x-4">
        <div className="min-w-0">
          <div className="font-mono text-[16px] font-medium text-[#B8B8B8]">Total Balance</div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[28px] font-bold leading-none text-white tabular-nums">{view.totalBalance}</span>
            <span className="font-mono text-[14px] text-[#B8B8B8]">USD</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[16px] font-medium text-[#B8B8B8]">Window Profit/Loss</div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[28px] font-bold leading-none text-white tabular-nums">{view.pnlValue}</span>
            <span className={cx("font-mono text-[14px] font-bold tabular-nums", view.pnlTone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]")}>
              ({view.pnlDelta})
            </span>
          </div>
        </div>
      </div>
    </section>
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
    <section className="mx-4 mt-9 flex min-h-0 flex-col border border-[#2A2A2A] bg-black/80">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A] px-4 py-4">
        <h2 className="font-mono text-base text-[#CFCFCF]">Portfolio Chart</h2>
        <TimeRangeSelector compact value={timeRange} onChange={onTimeRangeChange} />
      </div>
      <div className="h-[200px] p-4">
        <PortfolioChart data={view.mobileChartData} variant="mobile" />
      </div>
    </section>
  );
}

function MobileWalletSection({
  balances,
  agentMode,
}: {
  balances: WalletBalanceRow[];
  agentMode: string;
}) {
  return (
    <section className="mx-4 mt-9 overflow-hidden">
      <WalletSection balances={balances} agentMode={agentMode} compact />
    </section>
  );
}

function MobileRecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <section className="mx-4 mt-9 overflow-hidden border border-[#1A1A1A] bg-black">
      <div className="px-5 py-5">
        <h2 className="text-[24px] font-bold text-white">Recent Activity</h2>
      </div>
      <RecentActivity rows={rows} compact />
    </section>
  );
}

function MobileSystemBar({ system }: { system: SystemView }) {
  return (
    <div
      className="fixed left-0 right-0 z-40 border-y border-[#1A1A1A] bg-black"
      style={{ bottom: MOBILE_NAV_HEIGHT }}
    >
      <div className="mx-auto flex h-8 max-w-[640px] items-center justify-between gap-2 px-4 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-[#BEBEBE]">
        <span className="inline-flex items-center gap-1.5">
          <SystemDot tone={system.tone} size="h-1.5 w-1.5" />
          {system.tone === "green" ? "Operational" : "Degraded"}
        </span>
        <span>
          Latency: <span className="text-white">{system.latency}</span>
        </span>
        <span>
          Mode: <span className="text-white">{system.mode}</span>
        </span>
        <span className="hidden sm:inline">
          Cycle: <span className="text-white">{system.cycle}</span>
        </span>
      </div>
    </div>
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
        className="mx-auto grid max-w-[640px] grid-cols-5 px-1"
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
                active ? "text-[#00FF00]" : "text-[#7A7A7A] active:text-white",
              )}
            >
              {active ? (
                <span className="absolute top-0 h-0.5 w-4 rounded-full bg-[#00FF00]" aria-hidden="true" />
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

function MobileChartSection({
  view,
  timeRange,
  onTimeRangeChange,
}: {
  view: DashboardViewModel;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  return (
    <section className="mx-4 mt-9 overflow-hidden border border-[#1A1A1A] bg-black">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A] px-5 py-5">
        <h2 className="text-[24px] font-bold text-white">Portfolio Chart</h2>
        <TimeRangeSelector compact value={timeRange} onChange={onTimeRangeChange} />
      </div>
      <div className="p-4">
        <PortfolioChart data={view.mobileChartData} variant="mobile" />
      </div>
    </section>
  );
}

function MobileDashboard({
  view,
  activeSection,
  onNavigate,
  data,
  timeRange,
  onTimeRangeChange,
}: {
  view: DashboardViewModel;
  activeSection: DashboardSection;
  onNavigate: (section: DashboardSection) => void;
  data: StatusPayload | null;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}) {
  return (
    <div className="technical-grid relative min-h-screen bg-black text-white lg:hidden">
      <AsciiRaccoonWatermark />
      <MobileHeader />
      {view.telemetryError ? <TelemetryBanner message={view.telemetryError} /> : null}
      <main className="mx-auto max-w-[640px] pb-[100px]">
        <SectionTransition section={activeSection}>
          {(section) =>
            section === "logs" ? (
              <LogsPanel
                rows={view.logRows}
                agentLog={resolveAgentLogLine(data)}
                latestDecision={data?.latestDecision ?? null}
                agentRunning={Boolean(data?.health.agentRunning)}
                compact
              />
            ) : section === "positions" ? (
              <ActivePositionsPanel
                rows={view.positionRows}
                totalPositionValue={view.totalPositionValue}
                agentMode={view.agentMode}
                compact
              />
            ) : section === "chart" ? (
              <MobileChartSection view={view} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
            ) : section === "algorithm" ? (
              <DecisionAlgorithmPanel latestDecision={data?.latestDecision ?? null} compact />
            ) : (
              <>
                <MobileHeroMetrics view={view} />
                <MobilePerformanceWidget view={view} timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
                <MobileWalletSection balances={view.walletBalances} agentMode={view.agentMode} />
                <MobileRecentActivity rows={view.activityRows} />
              </>
            )
          }
        </SectionTransition>
      </main>
      <MobileSystemBar system={view.system} />
      <MobileBottomNav activeSection={activeSection} onNavigate={onNavigate} />
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [timeRange, setTimeRange] = useState<TimeRange>("1D");

  useEffect(() => {
    let active = true;

    async function load() {
      const startedAt = performance.now();

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
        setLatencyMs(Math.round(performance.now() - startedAt));
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLatencyMs(Math.round(performance.now() - startedAt));
      }
    }

    load();
    const interval = window.setInterval(load, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const view = useMemo(() => buildViewModel(data, error, latencyMs, timeRange), [data, error, latencyMs, timeRange]);

  return (
    <>
      <MobileDashboard
        view={view}
        activeSection={activeSection}
        onNavigate={setActiveSection}
        data={data}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />
      <DesktopDashboard
        view={view}
        activeSection={activeSection}
        onNavigate={setActiveSection}
        data={data}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />
    </>
  );
}
