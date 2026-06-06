"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CircleUserRound,
  Download,
  ExternalLink,
  FileText,
  Github,
  Home,
  Menu,
  Rocket,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { PortfolioChart, type PortfolioChartPoint } from "@/components/portfolio-chart";
import { statusSchema, type StatusPayload } from "@/lib/schemas";

const navItems: Array<{ label: string; icon: LucideIcon; active?: boolean }> = [
  { label: "Overview", icon: Home, active: true },
  { label: "Bot Performance", icon: Activity },
  { label: "Deployments", icon: Rocket },
  { label: "Logs", icon: FileText },
  { label: "Analytics", icon: BarChart3 },
  { label: "Settings", icon: Settings },
];

const mobileNavItems = [
  { label: "Overview", icon: Home, active: true },
  { label: "Logs", icon: FileText },
  { label: "Chart", icon: BarChart3 },
  { label: "Settings", icon: Settings },
];

const projectRepository = {
  owner: "AlejoReyna",
  name: "no-named-yet-bot",
  url: "https://github.com/AlejoReyna/ultraSecretYetPublicProject/tree/main/no-named-yet-bot",
  title: "No Named Yet Bot",
  description: "Autonomous trading bot with TWAK signing, CMC data, and strict guardrails.",
};

const timeRanges = ["1H", "1D", "1W", "1M"] as const;

type MetricView = {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  tone?: "positive" | "negative";
  tooltip?: string;
};

type ActivityRow = {
  amount: string;
  hash: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
  tone: "green" | "yellow" | "red";
};

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
  chartData: PortfolioChartPoint[];
  mobileChartData: PortfolioChartPoint[];
  totalBalance: string;
  pnlValue: string;
  pnlDelta: string;
  pnlTone: "positive" | "negative";
  performanceDelta: string;
  performanceTone: "positive" | "negative";
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

function numericPortfolioValues(data: StatusPayload | null) {
  return (
    data?.decisions
      .map((decision) => decision.portfolio_value_usdc)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? []
  );
}

function latestPortfolioValue(data: StatusPayload | null) {
  if (!data) {
    return null;
  }

  if (typeof data.wallet.portfolioTotalUsd === "number") {
    return data.wallet.portfolioTotalUsd;
  }

  if (typeof data.latestDecision?.portfolio_value_usdc === "number") {
    return data.latestDecision.portfolio_value_usdc;
  }

  return numericPortfolioValues(data).at(-1) ?? null;
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

function chartPoints(data: StatusPayload | null): PortfolioChartPoint[] {
  const points =
    data?.decisions
      .filter((decision) => typeof decision.portfolio_value_usdc === "number")
      .map((decision, index) => ({
        label: decision.cycle_number ? `#${decision.cycle_number}` : `${index + 1}`,
        value: decision.portfolio_value_usdc ?? 0,
      })) ?? [];

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
    data?.wallet.movements.slice(0, 7).map((movement) => {
      const failed = Boolean(movement.error) || String(movement.status ?? "").toLowerCase().includes("failed");
      const pending = !movement.txHash && !failed;

      return {
        amount: amountLabel(movement),
        hash: shortHash(movement.txHash),
        status: failed ? "FAILED" : pending ? "PENDING" : "SUCCESS",
        tone: failed ? "red" : pending ? "yellow" : "green",
      } satisfies ActivityRow;
    }) ?? [];

  if (movements.length > 0) {
    return movements;
  }

  return (
    data?.executions.slice(0, 7).map((execution) => {
      const failed = executionFailed(execution);
      const pending = !executionSucceeded(execution) && !failed;
      const from = execution.from_symbol ?? "";
      const to = execution.to_symbol ?? "";

      return {
        amount:
          typeof execution.amount_in === "number"
            ? `${compactNumberFormatter.format(execution.amount_in)} ${from}->${to}`
            : `${from}->${to}`,
        hash: shortHash(execution.tx_hash ?? stringFromUnknown(execution.result?.tx_hash) ?? stringFromUnknown(execution.result?.hash)),
        status: failed ? "FAILED" : pending ? "PENDING" : "SUCCESS",
        tone: failed ? "red" : pending ? "yellow" : "green",
      } satisfies ActivityRow;
    }) ?? []
  );
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

function buildViewModel(data: StatusPayload | null, error: string | null, latencyMs: number | null): DashboardViewModel {
  const values = numericPortfolioValues(data);
  const latest = latestPortfolioValue(data);
  const pnl = pnlFromWindow(values);
  const pnlTone = (pnl.absolute ?? 0) >= 0 ? "positive" : "negative";
  const activeTrades = data?.positions.positions.length ?? data?.latestDecision?.position_count ?? 0;
  const successRate = executionSuccessRate(data?.executions ?? []);
  const chart = chartPoints(data);
  const performanceDelta = formatPercent(pnl.percent);

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
        tooltip: "Open positions reported by positions.json or latest decision telemetry.",
      },
      {
        label: "Execution Rate",
        value: successRate === null ? "N/A" : `${successRate.toFixed(1)}%`,
        tooltip: "Successful execution records over resolved execution attempts.",
      },
    ],
    activityRows: activityFromTelemetry(data),
    chartData: chart,
    mobileChartData: chart.slice(-16).length > 1 ? chart.slice(-16) : chart,
    totalBalance: formatUsd(latest),
    pnlValue: formatSignedUsd(pnl.absolute),
    pnlDelta: performanceDelta,
    pnlTone,
    performanceDelta,
    performanceTone: pnlTone,
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

function GithubRepositoryCard() {
  return (
    <a
      href={projectRepository.url}
      target="_blank"
      rel="noreferrer"
      className="group block w-full border border-[#1A1A1A] bg-[#070707] p-3 text-left transition-colors hover:border-[#2A2A2A] hover:bg-[#0B0B0B]"
      aria-label="Open cascade-ai project on GitHub"
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center border border-[#242424] bg-[#111111] text-white">
            <Github size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-[10px] uppercase leading-4 tracking-[0.18em] text-[#777777]">
              {projectRepository.owner}
            </span>
            <span className="block truncate text-sm font-semibold leading-5 text-[#F2F2F2]">{projectRepository.name}</span>
          </span>
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center border border-[#242424] bg-[#111111] text-[#8A8A8A] transition-colors group-hover:text-white">
          <ExternalLink size={14} />
        </span>
      </span>
      <span className="mt-3 flex items-center">
        <span className="inline-flex items-center gap-1.5 border border-[#202020] bg-black px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#A8A8A8]">
          <PythonLogo className="h-3 w-3 shrink-0" />
          Python
        </span>
      </span>
      <span className="mt-3 block overflow-hidden text-xs leading-5 text-[#BDBDBD] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {projectRepository.description}
      </span>
    </a>
  );
}

function DesktopSidebar() {
  return (
    <aside className="flex min-h-screen w-[280px] shrink-0 flex-col border-r border-[#1A1A1A] bg-[#050505] 2xl:w-[320px]">
      <div className="border-b border-[#1A1A1A] px-5 py-5">
        <GithubRepositoryCard />
      </div>
      <nav className="grid gap-1 px-3 py-5">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <a
              key={item.label}
              className={cx(
                "group flex h-12 items-center gap-3 border border-transparent px-3 font-mono text-[13px] transition-colors",
                item.active
                  ? "border-[#1A1A1A] bg-[#0D1A12] text-white shadow-[inset_3px_0_0_#00FF00]"
                  : "text-[#C9C9C9] hover:border-[#1A1A1A] hover:bg-[#0A0A0A] hover:text-white",
              )}
              href="#"
            >
              <Icon
                size={17}
                className={cx("shrink-0", item.active ? "text-[#00FF00]" : "text-[#A3A3A3] group-hover:text-white")}
              />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-[#1A1A1A] px-5 py-5">
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

function DesktopHeader() {
  return (
    <header className="flex h-20 shrink-0 items-center justify-between border-b border-[#1A1A1A] bg-[#050505]/95 px-8">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#7A7A7A]">VibeCoded UI v0.3.1</div>
        <div className="mt-1 truncate text-sm text-[#D4D4D4]">{projectRepository.title}</div>
      </div>
      <button className="inline-flex h-10 items-center gap-2 border border-[#333333] bg-[#171717] px-5 font-mono text-sm text-white transition-colors hover:border-[#4A4A4A] hover:bg-[#202020]">
        <Download size={16} />
        <span>Export CSV</span>
      </button>
    </header>
  );
}

function DesktopMetricBlock({ label, value, unit, delta, tone, tooltip }: MetricView) {
  return (
    <div className="min-w-0 border-l border-[#1A1A1A] pl-5">
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

function DesktopTimeRangeSelector() {
  return (
    <div className="flex items-center gap-2">
      {timeRanges.map((range) => (
        <button
          key={range}
          className={cx(
            "h-8 min-w-10 border px-3 font-mono text-xs transition-colors",
            range === "1W"
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

function DesktopPerformancePanel({ view }: { view: DashboardViewModel }) {
  return (
    <section className="flex min-h-0 flex-col px-10 py-9">
      <div className="mb-9">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Overview</div>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight text-white">Bot Performance</h1>
      </div>
      <div className="grid gap-x-6 gap-y-7 lg:grid-cols-2 2xl:grid-cols-[1.25fr_1fr_0.72fr_0.72fr]">
        {view.metrics.map((metric) => (
          <DesktopMetricBlock key={metric.label} {...metric} />
        ))}
      </div>
      <div className="mt-10 flex min-h-0 flex-1 flex-col border border-[#2A2A2A] bg-black/80">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1A1A1A] px-7 py-5">
          <h2 className="font-mono text-lg text-[#CFCFCF]">Portfolio Chart</h2>
          <DesktopTimeRangeSelector />
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

function RecentActivity({ rows, compact = false }: { rows: ActivityRow[]; compact?: boolean }) {
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-[34%]" />
        <col className="w-[30%]" />
        <col className="w-[36%]" />
      </colgroup>
      <thead className="border-y border-[#1A1A1A] font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8A8A]">
        <tr>
          <th className="px-4 py-4">Amount</th>
          <th className="px-1 py-4">TX Hash</th>
          <th className="px-4 py-4 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {(compact ? rows.slice(0, 4) : rows).map((row, index) => (
          <tr key={`${row.hash}-${row.amount}-${index}`} className="border-b border-[#1A1A1A] text-white hover:bg-[#070707]">
            <td className="truncate px-4 py-5 font-mono text-[13px] font-bold tabular-nums">{row.amount}</td>
            <td className="truncate px-1 py-5 font-mono text-[12px] font-bold text-[#D0D0D0]">{row.hash}</td>
            <td className="px-4 py-4 text-right">
              <StatusBadge status={row.status} tone={row.tone} />
            </td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr className="border-b border-[#1A1A1A]">
            <td className="px-4 py-5 font-mono text-[12px] text-[#8A8A8A]" colSpan={3}>
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
    <section className="flex min-h-0 flex-col border-l border-[#1A1A1A] bg-black/72 px-5 py-9 2xl:px-7">
      <div className="border border-[#2A2A2A] bg-black/88">
        <div className="border-b border-[#1A1A1A] px-5 py-5">
          <h2 className="font-mono text-xl text-[#DADADA]">Recent Activity</h2>
        </div>
        <div className="console-scroll overflow-x-auto">
          <RecentActivity rows={rows} />
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

function DesktopDashboard({ view }: { view: DashboardViewModel }) {
  return (
    <div className="hidden min-h-screen bg-black text-white lg:flex">
      <DesktopSidebar />
      <main className="technical-grid min-w-0 flex-1 pb-9">
        <DesktopHeader />
        <section className="grid min-h-[calc(100vh-116px)] grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,65fr)_minmax(330px,35fr)] 2xl:grid-cols-[minmax(0,65fr)_minmax(400px,35fr)]">
          <DesktopPerformancePanel view={view} />
          <DesktopRecentActivity rows={view.activityRows} />
        </section>
      </main>
      <DesktopStatusBar system={view.system} />
    </div>
  );
}

function MobileHeader() {
  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-[#1A1A1A] bg-[#050505]">
      <div className="mx-auto flex h-[74px] max-w-[640px] items-center justify-between px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{projectRepository.name}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#777777]">Monolith Terminal v2</div>
        </div>
        <button className="grid h-11 w-11 place-items-center border border-[#1A1A1A] text-[#CFCFCF] hover:bg-[#101010]" aria-label="Open menu">
          <Menu size={24} strokeWidth={2.2} />
        </button>
      </div>
    </header>
  );
}

function MobileHeroMetrics({ view }: { view: DashboardViewModel }) {
  return (
    <section className="px-4 pt-7">
      <GithubRepositoryCard />
      <div className="mt-7 text-[16px] font-medium text-[#B8B8B8]">Total Balance</div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[34px] font-bold leading-none text-white tabular-nums">{view.totalBalance}</span>
        <span className="font-mono text-[18px] text-[#B8B8B8]">USD</span>
      </div>
      <div className="mt-8 text-[16px] font-medium text-[#B8B8B8]">Window Profit/Loss</div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[29px] font-bold leading-none text-white tabular-nums">{view.pnlValue}</span>
        <span className={cx("font-mono text-[18px] font-bold tabular-nums", view.pnlTone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]")}>
          ({view.pnlDelta})
        </span>
      </div>
    </section>
  );
}

function MobilePerformanceWidget({ view }: { view: DashboardViewModel }) {
  return (
    <section className="mx-4 mt-9 border border-[#1A1A1A] bg-black px-5 py-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-bold text-white">Performance</h1>
        <span className={cx("font-mono text-[18px] font-bold tabular-nums", view.performanceTone === "negative" ? "text-[#FF3737]" : "text-[#00FF00]")}>
          {view.performanceDelta}
        </span>
      </div>
      <div className="h-[150px] border border-[#1A1A1A] bg-[#050505]">
        <PortfolioChart data={view.mobileChartData} variant="mobile" />
      </div>
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
    <div className="fixed bottom-[76px] left-0 right-0 z-40 border-y border-[#1A1A1A] bg-black">
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

function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#1A1A1A] bg-[#050505]">
      <div className="mx-auto grid h-[76px] max-w-[640px] grid-cols-4 px-4">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;

          return (
            <a
              key={item.label}
              className={cx(
                "flex min-h-11 flex-col items-center justify-center gap-1 font-mono text-[11px] font-bold uppercase",
                item.active ? "text-[#00FF00]" : "text-[#8A8A8A]",
              )}
              href="#"
            >
              <Icon size={23} strokeWidth={2.1} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function MobileDashboard({ view }: { view: DashboardViewModel }) {
  return (
    <div className="technical-grid min-h-screen bg-black text-white lg:hidden">
      <MobileHeader />
      <main className="mx-auto max-w-[640px] pb-[124px] pt-[74px]">
        <MobileHeroMetrics view={view} />
        <MobilePerformanceWidget view={view} />
        <MobileRecentActivity rows={view.activityRows} />
      </main>
      <MobileSystemBar system={view.system} />
      <MobileBottomNav />
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

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

  const view = useMemo(() => buildViewModel(data, error, latencyMs), [data, error, latencyMs]);

  return (
    <>
      <MobileDashboard view={view} />
      <DesktopDashboard view={view} />
    </>
  );
}
