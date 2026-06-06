"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Link2,
  ListChecks,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  statusSchema,
  type CommandResult,
  type Decision,
  type Execution,
  type Position,
  type StatusPayload,
  type WalletBalance,
  type WalletMovement,
} from "@/lib/schemas";

const WALLET_ADDRESS = "0x7CE28f5d2D1B2eFd8f87FF0a7fdC7D2EaB465c9c";
const CYCLE_SECONDS = 300;

const PortfolioChart = dynamic(
  () => import("@/components/portfolio-chart").then((module) => module.PortfolioChart),
  {
    ssr: false,
    loading: () => <div className="grid h-full place-items-center text-sm text-[#848E9C]">Loading chart</div>,
  },
);

const FACTORS: Array<{ key: keyof NonNullable<Decision["factor_scores"]>; label: string }> = [
  { key: "volume_breakout", label: "Volume breakout" },
  { key: "six_hour_high_break", label: "Six hour high" },
  { key: "regime_not_risk_off", label: "Regime clear" },
  { key: "slippage_under_cap", label: "Slippage cap" },
  { key: "rsi_in_range", label: "RSI range" },
  { key: "derivatives_risk_clear", label: "Derivatives clear" },
];

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatUsd(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? usdFormatter.format(value) : "N/A";
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? numberFormatter.format(value) : "N/A";
}

function formatSlippage(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "N/A";
}

function formatDistance(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function shortHash(value: string | null | undefined, front = 6, back = 4) {
  if (!value) {
    return "N/A";
  }

  if (value.length <= front + back) {
    return value;
  }

  return `${value.slice(0, front)}...${value.slice(-back)}`;
}

function explorerFor(chain: string | null | undefined, hash: string | null | undefined) {
  if (!hash || !isRealHash(hash)) {
    return null;
  }

  if ((chain ?? "").toLowerCase() === "base") {
    return `https://basescan.org/tx/${hash}`;
  }

  if ((chain ?? "").toLowerCase() === "bsc") {
    return `https://bscscan.com/tx/${hash}`;
  }

  return null;
}

function formatChain(chain: string | null | undefined) {
  const value = chain?.toLowerCase();
  if (value === "bsc") {
    return "BSC";
  }

  if (value === "base") {
    return "Base";
  }

  return chain ?? "N/A";
}

function parseTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function TimeValue({ value }: { value: string | null | undefined }) {
  const date = parseTime(value);

  if (!date) {
    return <span className="text-[#848E9C]">N/A</span>;
  }

  return (
    <time dateTime={date.toISOString()} title={`UTC: ${date.toISOString()}`}>
      {date.toLocaleString()}
    </time>
  );
}

function countdownLabel(ms: number | null) {
  if (ms === null) {
    return "N/A";
  }

  if (ms <= 0) {
    return "due now";
  }

  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getResultString(execution: Execution, key: string) {
  const value = execution.result?.[key];

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return null;
}

function executionMode(execution: Execution) {
  if (execution.tx_hash?.startsWith("paper-")) {
    return "paper";
  }

  return getResultString(execution, "mode") ?? "unknown";
}

function isRealHash(hash: string | null | undefined) {
  return Boolean(hash && /^0x[a-fA-F0-9]{64}$/.test(hash));
}

function distanceFromEntry(entry: number | null | undefined, target: number | null | undefined) {
  if (!entry || !target || !Number.isFinite(entry) || !Number.isFinite(target)) {
    return null;
  }

  return ((target - entry) / entry) * 100;
}

function statusFrom(data: StatusPayload | null, now: number) {
  const lastCycle = parseTime(data?.latestDecision?.timestamp);
  const stale = lastCycle ? now - lastCycle.getTime() > (CYCLE_SECONDS + 60) * 1000 : true;

  if (!data?.health.agentRunning) {
    return {
      label: "Stopped",
      className: "rounded bg-[#F6465D]/10 text-[#F6465D]",
      dot: "bg-[#F6465D]",
    };
  }

  if (stale) {
    return {
      label: "Stale",
      className: "rounded bg-[#F0B90B]/10 text-[#F0B90B]",
      dot: "bg-[#F0B90B]",
    };
  }

  return {
    label: "Running",
    className: "rounded bg-[#0ECB81]/10 text-[#0ECB81]",
    dot: "bg-[#0ECB81]",
  };
}

function actionClass(action: string | null | undefined) {
  switch (action) {
    case "ENTER":
      return "rounded bg-[#0ECB81]/10 text-[#0ECB81]";
    case "HALT":
      return "rounded bg-[#F6465D]/10 text-[#F6465D]";
    case "BLOCKED":
      return "rounded bg-[#F0B90B]/10 text-[#F0B90B]";
    default:
      return "rounded bg-[#2B3139] text-[#EAECEF]";
  }
}

function modeClass(mode: string) {
  return mode === "live"
    ? "rounded bg-[#0ECB81]/10 text-[#0ECB81]"
    : "rounded bg-[#F0B90B]/10 text-[#F0B90B]";
}

function Metric({
  label,
  value,
  detail,
  tone = "cyan",
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  tone?: "cyan" | "green" | "red" | "yellow" | "slate";
}) {
  const valueColor = {
    cyan: "text-[#F0B90B]",
    green: "text-[#0ECB81]",
    red: "text-[#F6465D]",
    yellow: "text-[#F0B90B]",
    slate: "text-[#EAECEF]",
  }[tone];

  return (
    <div className="min-w-0 rounded-md border border-[#2B3139] bg-[#1E2329] p-4">
      <div className="mb-2 truncate text-sm font-medium text-[#848E9C]">{label}</div>
      <div className={cx("truncate text-2xl font-semibold tabular-nums", valueColor)}>{value}</div>
      {detail ? <div className="mt-1 truncate text-xs text-[#848E9C]">{detail}</div> : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-6">
      <h2 className="mb-4 text-lg font-medium text-[#EAECEF]">{title}</h2>
      {children}
    </section>
  );
}

function HashLink({ hash, mode }: { hash: string | null | undefined; mode: string }) {
  if (!hash) {
    return <span className="text-[#848E9C]">N/A</span>;
  }

  if (mode === "twak" && isRealHash(hash)) {
    return (
      <a
        className="inline-flex items-center gap-1 text-[#F0B90B] underline decoration-[#F0B90B]/30 underline-offset-4 hover:text-[#F0B90B]/80"
        href={`https://bscscan.com/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        title={hash}
      >
        {shortHash(hash)}
        <ExternalLink size={12} />
      </a>
    );
  }

  return <span title={hash}>{shortHash(hash)}</span>;
}

function TxHashLink({
  hash,
  chain,
  href,
}: {
  hash: string | null | undefined;
  chain?: string | null;
  href?: string | null;
}) {
  if (!hash) {
    return <span className="text-[#848E9C]">N/A</span>;
  }

  const target = href ?? explorerFor(chain, hash);

  if (target) {
    return (
      <a
        className="inline-flex items-center gap-1 text-[#F0B90B] underline decoration-[#F0B90B]/30 underline-offset-4 hover:text-[#F0B90B]/80"
        href={target}
        target="_blank"
        rel="noreferrer"
        title={hash}
      >
        {shortHash(hash)}
        <ExternalLink size={12} />
      </a>
    );
  }

  return <span title={hash}>{shortHash(hash)}</span>;
}

function SourceChip({ source }: { source: WalletMovement["source"] }) {
  const labels: Record<WalletMovement["source"], string> = {
    "twak-history": "TWAK history",
    "execution-log": "Execution log",
    merged: "Merged",
  };
  const className: Record<WalletMovement["source"], string> = {
    "twak-history": "bg-[#F0B90B]/10 text-[#F0B90B]",
    "execution-log": "bg-[#2B3139] text-[#EAECEF]",
    merged: "bg-[#0ECB81]/10 text-[#0ECB81]",
  };

  return <span className={cx("inline-flex rounded px-2 py-0.5 text-xs font-semibold", className[source])}>{labels[source]}</span>;
}

function BalanceList({ balances }: { balances: WalletBalance[] }) {
  if (balances.length === 0) {
    return <div className="rounded border border-[#2B3139] bg-[#181A20] px-3 py-2 text-sm text-[#848E9C]">No balance data.</div>;
  }

  return (
    <div className="grid gap-2">
      {balances.map((balance, index) => (
        <div
          key={`${balance.chain}-${balance.symbol}-${balance.tokenAddress ?? index}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded border border-[#2B3139] bg-[#181A20] px-3 py-2 text-sm"
        >
          <span className="min-w-0 truncate font-semibold text-[#EAECEF]" title={balance.symbol}>
            {balance.symbol}
          </span>
          <span className="font-mono tabular-nums text-[#EAECEF]">{formatNumber(balance.amount)}</span>
          {typeof balance.valueUsd === "number" ? (
            <span className="col-span-2 text-right text-xs text-[#848E9C]">{formatUsd(balance.valueUsd)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function movementPair(movement: WalletMovement) {
  const input =
    typeof movement.amountIn === "number"
      ? `${formatNumber(movement.amountIn)} ${movement.fromSymbol ?? ""}`.trim()
      : movement.fromSymbol ?? null;
  const output = movement.output ?? movement.toSymbol ?? null;

  if (input && output) {
    return `${input} -> ${output}`;
  }

  return input ?? output ?? "N/A";
}

function TwakResultRow({ label, result }: { label: string; result: CommandResult | undefined }) {
  const ok = result?.ok === true;
  const preview =
    result?.data === null || result?.data === undefined
      ? result?.error ?? "No data"
      : JSON.stringify(result.data, null, 2);

  return (
    <div className="grid gap-3 border-t border-[#2B3139] py-3 sm:grid-cols-[150px_80px_1fr]">
      <div className="text-sm font-medium text-[#EAECEF]">{label}</div>
      <div>
        <span
          className={cx(
            "inline-flex rounded px-2 py-1 text-xs font-semibold",
            ok ? "bg-[#0ECB81]/10 text-[#0ECB81]" : "bg-[#2B3139] text-[#848E9C]",
          )}
        >
          {ok ? "OK" : "READ ONLY"}
        </span>
      </div>
      <pre className="console-scroll max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-[#181A20] p-3 font-mono text-xs leading-5 text-[#848E9C]">
        {preview}
      </pre>
    </div>
  );
}

export function DashboardClient() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

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
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    const poll = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = data?.latestDecision ?? null;
  const latestTime = parseTime(latest?.timestamp);
  const nextCycleMs = latestTime ? latestTime.getTime() + CYCLE_SECONDS * 1000 - now : null;
  const status = statusFrom(data, now);
  const mode = (latest?.mode ?? "paper").toLowerCase() === "live" ? "live" : "paper";
  const portfolioValue = latest?.portfolio_value_usdc;
  const portfolioAth = data?.guardrails.portfolio_ath;
  const drawdown =
    typeof portfolioValue === "number" && typeof portfolioAth === "number" && portfolioAth > 0
      ? ((portfolioValue - portfolioAth) / portfolioAth) * 100
      : null;
  const wallet = data?.wallet;
  const walletAddress = wallet?.address ?? WALLET_ADDRESS;
  const walletPortfolioValue = wallet?.portfolioTotalUsd ?? portfolioValue;
  const walletPortfolioSource = typeof wallet?.portfolioTotalUsd === "number" ? "TWAK portfolio" : "Latest decision fallback";
  const bscBalances = wallet?.balances.filter((balance) => balance.chain.toLowerCase() === "bsc") ?? [];
  const baseBalances = wallet?.balances.filter((balance) => balance.chain.toLowerCase() === "base") ?? [];
  const basePaymentBalances = baseBalances.filter((balance) => /usdc|x402/i.test(balance.symbol));
  const walletMovements = wallet?.movements ?? [];

  const chartData = useMemo(
    () =>
      (data?.decisions ?? [])
        .filter((decision) => typeof decision.portfolio_value_usdc === "number")
        .map((decision) => {
          const date = parseTime(decision.timestamp);

          return {
            label: date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : decision.timestamp,
            value: decision.portfolio_value_usdc ?? 0,
          };
        }),
    [data?.decisions],
  );

  return (
    <main className="min-h-screen bg-[#181A20] px-4 py-4 text-[#EAECEF] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
        <header className="sticky top-0 z-50 -mx-4 border-b border-[#2B3139] bg-[#181A20] px-4 pb-5 pt-1 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={cx("inline-flex items-center gap-2 px-3 py-1 text-sm font-semibold", status.className)}>
                  <span className={cx("h-2 w-2 rounded-full", status.dot)} />
                  {status.label}
                </span>
                <span className={cx("inline-flex px-3 py-1 text-sm font-semibold", modeClass(mode))}>
                  {mode}
                </span>
                <span className="inline-flex items-center gap-2 rounded bg-[#2B3139] px-3 py-1 text-sm text-[#EAECEF]">
                  <Wallet size={14} className="text-[#848E9C]" />
                  <span className="font-mono tabular-nums" title={walletAddress}>{shortHash(walletAddress)}</span>
                </span>
                <span className="inline-flex items-center gap-2 rounded bg-[#0ECB81]/10 px-3 py-1 text-sm text-[#0ECB81]">
                  <Link2 size={14} />
                  BSC execution
                </span>
                <span className="inline-flex items-center gap-2 rounded bg-[#F0B90B]/10 px-3 py-1 text-sm text-[#F0B90B]">
                  <Zap size={14} />
                  Base x402
                </span>
              </div>
              <h1 className="text-3xl font-semibold text-[#EAECEF] sm:text-4xl">Cascade AI Trading Agent</h1>
              <div className="mt-3 grid gap-3 text-sm text-[#848E9C] md:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-[#848E9C]" />
                  <span>Last cycle: </span>
                  <span className="text-[#EAECEF]">
                    <TimeValue value={latest?.timestamp} />
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <RefreshCw size={15} className="text-[#848E9C]" />
                  <span>Next expected: </span>
                  <span className="font-semibold tabular-nums text-[#EAECEF]">{countdownLabel(nextCycleMs)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Server size={15} className="text-[#848E9C]" />
                  <span className="truncate" title={data?.health.sourcePath}>
                    {data?.health.sourcePath ?? "loading"}
                  </span>
                </div>
              </div>
            </div>

            <div className="w-full rounded-lg border border-[#2B3139] bg-[#1E2329] p-4 lg:max-w-xl">
              <div className="mb-2 text-sm font-medium text-[#848E9C]">Latest decision</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx("px-2.5 py-1 text-sm font-semibold", actionClass(latest?.action))}>
                  {latest?.action ?? "N/A"}
                </span>
                <span className="rounded bg-[#2B3139] px-2.5 py-1 text-sm text-[#EAECEF]">
                  {latest?.symbol ?? "N/A"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#848E9C]">{latest?.reason ?? "Waiting for telemetry."}</p>
              {error ? (
                <div className="mt-3 flex items-start gap-2 rounded bg-[#F0B90B]/10 p-2 text-xs text-[#F0B90B]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <Section icon={TrendingUp} title="Portfolio Overview">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Metric icon={TrendingUp} label="Portfolio value" value={formatUsd(portfolioValue)} detail="Latest cycle" tone="green" />
            <Metric icon={Wallet} label="Open positions" value={formatNumber(data?.positions.positions.length ?? latest?.position_count)} />
            <Metric icon={ListChecks} label="Daily trades" value={formatNumber(data?.guardrails.daily_trade_count)} />
            <Metric icon={ShieldCheck} label="Portfolio ATH" value={formatUsd(portfolioAth)} />
            <Metric
              icon={TrendingDown}
              label="Drawdown"
              value={formatDistance(drawdown)}
              tone={drawdown !== null && drawdown < -5 ? "red" : "yellow"}
            />
            <Metric
              icon={Database}
              label="Source"
              value={data?.connection?.source ?? (loading ? "loading" : "unknown")}
              detail={data?.connection?.fetchedAt ? `Fetched ${new Date(data.connection.fetchedAt).toLocaleTimeString()}` : undefined}
              tone="slate"
            />
          </div>

          <div className="mt-5 h-72 rounded-lg border border-[#2B3139] bg-[#1E2329] p-4">
            <PortfolioChart data={chartData} />
          </div>
        </Section>

        <Section icon={Wallet} title="TWAK Wallet">
          <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
            <div className="rounded-lg border border-[#2B3139] bg-[#1E2329] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric icon={Wallet} label="Wallet address" value={shortHash(walletAddress)} detail={walletAddress} tone="slate" />
                <Metric icon={TrendingUp} label="Portfolio total" value={formatUsd(walletPortfolioValue)} detail={walletPortfolioSource} tone="green" />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-[#EAECEF]">BSC balances</h3>
                    <span className="rounded bg-[#0ECB81]/10 px-2 py-0.5 text-xs font-semibold text-[#0ECB81]">BSC</span>
                  </div>
                  <BalanceList balances={bscBalances} />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-[#EAECEF]">Base USDC / x402</h3>
                    <span className="rounded bg-[#F0B90B]/10 px-2 py-0.5 text-xs font-semibold text-[#F0B90B]">Base</span>
                  </div>
                  <BalanceList balances={basePaymentBalances.length > 0 ? basePaymentBalances : baseBalances} />
                </div>
              </div>

              <div className="mt-5 border-t border-[#2B3139] pt-4">
                <div className="mb-2 text-sm font-medium text-[#848E9C]">TWAK read status</div>
                {(wallet?.errors.length ?? 0) > 0 ? (
                  <div className="grid gap-2">
                    {wallet?.errors.map((readError) => (
                      <div key={`${readError.source}-${readError.error}`} className="rounded border border-[#F0B90B]/20 bg-[#F0B90B]/10 px-3 py-2 text-xs text-[#F0B90B]">
                        <span className="font-semibold">{readError.source}: </span>
                        {readError.error}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-[#2B3139] bg-[#181A20] px-3 py-2 text-sm text-[#0ECB81]">All read-only TWAK calls returned safely.</div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[#2B3139] bg-[#1E2329]">
              <div className="border-b border-[#2B3139] bg-[#181A20] px-4 py-3">
                <h3 className="text-sm font-medium text-[#EAECEF]">Wallet movements</h3>
              </div>
              <div className="console-scroll overflow-x-auto">
                <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
                  <thead className="bg-[#181A20] text-xs font-medium text-[#848E9C]">
                    <tr>
                      <th className="px-4 py-2 text-left">Time</th>
                      <th className="px-4 py-2 text-left">Chain</th>
                      <th className="px-4 py-2 text-left">Action</th>
                      <th className="px-4 py-2 text-left">Pair / input / output</th>
                      <th className="px-4 py-2 text-left">Provider</th>
                      <th className="px-4 py-2 text-left">Tx hash</th>
                      <th className="px-4 py-2 text-left">Approval</th>
                      <th className="px-4 py-2 text-left">Source</th>
                      <th className="px-4 py-2 text-left">Error / status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletMovements.map((movement: WalletMovement, index) => (
                      <tr key={`${movement.source}-${movement.txHash ?? movement.timestamp ?? index}`} className="border-b border-[#2B3139] text-[#EAECEF] hover:bg-[#2B3139]">
                        <td className="px-4 py-2 text-[#848E9C]">
                          <TimeValue value={movement.timestamp} />
                        </td>
                        <td className="px-4 py-2">
                          <span className="rounded bg-[#2B3139] px-2 py-0.5 text-xs font-semibold">{formatChain(movement.chain)}</span>
                        </td>
                        <td className="px-4 py-2 font-medium">{movement.action}</td>
                        <td className="px-4 py-2 text-[#EAECEF]">{movementPair(movement)}</td>
                        <td className="px-4 py-2 text-[#848E9C]">{movement.provider ?? "N/A"}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <TxHashLink hash={movement.txHash} chain={movement.chain} href={movement.explorerUrl} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <TxHashLink hash={movement.approvalHash} chain={movement.chain} />
                        </td>
                        <td className="px-4 py-2">
                          <SourceChip source={movement.source} />
                        </td>
                        <td className={cx("px-4 py-2", movement.error ? "text-[#F6465D]" : "text-[#848E9C]")}>
                          {movement.error ?? movement.status ?? "N/A"}
                        </td>
                      </tr>
                    ))}
                    {walletMovements.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-[#848E9C]" colSpan={9}>
                          No wallet movements available.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <details className="mt-5 rounded-lg border border-[#2B3139] bg-[#1E2329] p-4">
            <summary className="cursor-pointer text-sm font-medium text-[#848E9C]">Raw read-only TWAK command output</summary>
            <div className="mt-4">
              <TwakResultRow label="BSC address" result={data?.balances.bscAddress} />
              <TwakResultRow label="Base address" result={data?.balances.baseAddress} />
              <TwakResultRow label="Portfolio" result={data?.balances.portfolio} />
              <TwakResultRow label="BSC balance" result={data?.balances.bscBalance} />
              <TwakResultRow label="Base balance" result={data?.balances.baseBalance} />
              <TwakResultRow label="BSC history" result={data?.balances.bscHistory} />
              <TwakResultRow label="Base history" result={data?.balances.baseHistory} />
            </div>
          </details>
        </Section>

        <Section icon={ListChecks} title="Agent Decision Pipeline">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="rounded-lg border border-[#2B3139] bg-[#1E2329] p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {FACTORS.map((factor) => {
                  const passed = latest?.factor_scores?.[factor.key] === true;

                  return (
                    <div key={factor.key} className="flex items-center justify-between gap-3 rounded border border-[#2B3139] bg-[#181A20] px-3 py-2">
                      <span className="text-sm text-[#EAECEF]">{factor.label}</span>
                      {passed ? <CheckCircle2 size={18} className="text-[#0ECB81]" /> : <XCircle size={18} className="text-[#F6465D]" />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric icon={CheckCircle2} label="True factors" value={`${formatNumber(latest?.true_factor_count)} / 6`} tone="green" />
                <Metric icon={Activity} label="Symbol" value={latest?.symbol ?? "N/A"} />
                <Metric icon={TrendingDown} label="Slippage" value={formatSlippage(latest?.estimated_slippage_pct)} tone="yellow" />
              </div>
              <div className="mt-4 rounded border border-[#2B3139] bg-[#181A20] p-3 text-sm leading-6 text-[#848E9C]">
                {latest?.reason ?? "No decision reason available."}
              </div>
            </div>

            <div className="rounded-lg border border-[#2B3139] bg-[#1E2329]">
              <div className="grid grid-cols-[130px_90px_1fr] border-b border-[#2B3139] bg-[#181A20] px-4 py-2 text-xs font-medium text-[#848E9C]">
                <span>Time</span>
                <span>Action</span>
                <span>Reason</span>
              </div>
              <div className="console-scroll max-h-[420px] overflow-auto">
                {(data?.decisions ?? []).slice(-12).reverse().map((decision) => (
                  <div key={`${decision.timestamp}-${decision.cycle_number ?? ""}`} className="grid grid-cols-[130px_90px_1fr] gap-3 border-b border-[#2B3139] px-4 py-2 text-sm hover:bg-[#2B3139]">
                    <span className="text-[#848E9C]">
                      <TimeValue value={decision.timestamp} />
                    </span>
                    <span>
                      <span className={cx("px-2 py-0.5 text-xs font-semibold", actionClass(decision.action))}>{decision.action}</span>
                    </span>
                    <span className="min-w-0 text-[#848E9C]">
                      <span className="mr-2 font-semibold text-[#EAECEF]">{decision.symbol ?? "N/A"}</span>
                      {decision.reason ?? "N/A"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section icon={Wallet} title="Open Positions">
          <div className="console-scroll overflow-x-auto rounded-lg border border-[#2B3139] bg-[#1E2329]">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#181A20] text-xs font-medium text-[#848E9C]">
                <tr>
                  <th className="px-4 py-2 text-left">Symbol</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-right">Entry</th>
                  <th className="px-4 py-2 text-right">Entry value</th>
                  <th className="px-4 py-2 text-right">Highest</th>
                  <th className="px-4 py-2 text-right">Trailing stop</th>
                  <th className="px-4 py-2 text-right">Take profit</th>
                  <th className="px-4 py-2 text-left">Opened</th>
                </tr>
              </thead>
              <tbody>
                {(data?.positions.positions ?? []).map((position: Position) => (
                  <tr key={`${position.symbol}-${position.opened_at ?? ""}`} className="border-b border-[#2B3139] text-[#EAECEF] hover:bg-[#2B3139]">
                    <td className="px-4 py-2 font-semibold">{position.symbol}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{formatNumber(position.amount_tokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatUsd(position.entry_price)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatUsd(position.entry_value_usdc)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatUsd(position.highest_price)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <div>{formatUsd(position.trailing_stop_price)}</div>
                      <div className="text-xs text-[#F6465D]">{formatDistance(distanceFromEntry(position.entry_price, position.trailing_stop_price))}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <div>{formatUsd(position.take_profit_price)}</div>
                      <div className="text-xs text-[#0ECB81]">{formatDistance(distanceFromEntry(position.entry_price, position.take_profit_price))}</div>
                    </td>
                    <td className="px-4 py-2 text-[#848E9C]">
                      <TimeValue value={position.opened_at} />
                    </td>
                  </tr>
                ))}
                {(data?.positions.positions.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-[#848E9C]" colSpan={8}>
                      No open positions.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Section>

        <Section icon={FileText} title="Execution Log">
          <div className="console-scroll overflow-x-auto rounded-lg border border-[#2B3139] bg-[#1E2329]">
            <table className="min-w-[1080px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#181A20] text-xs font-medium text-[#848E9C]">
                <tr>
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Action</th>
                  <th className="px-4 py-2 text-left">Pair</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Mode</th>
                  <th className="px-4 py-2 text-left">Tx hash</th>
                  <th className="px-4 py-2 text-left">Approval</th>
                  <th className="px-4 py-2 text-left">Provider</th>
                  <th className="px-4 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {(data?.executions ?? []).map((execution: Execution) => {
                  const modeValue = executionMode(execution);
                  const paper = modeValue === "paper" || execution.tx_hash?.startsWith("paper-");

                  return (
                    <tr key={`${execution.timestamp}-${execution.tx_hash ?? execution.action ?? ""}`} className="border-b border-[#2B3139] text-[#EAECEF] hover:bg-[#2B3139]">
                      <td className="px-4 py-2 text-[#848E9C]">
                        <TimeValue value={execution.timestamp} />
                      </td>
                      <td className="px-4 py-2">{execution.action ?? "N/A"}</td>
                      <td className="px-4 py-2 font-semibold">
                        {execution.from_symbol ?? "N/A"} to {execution.to_symbol ?? "N/A"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatNumber(execution.amount_in)}</td>
                      <td className="px-4 py-2">
                        <span className={cx("px-2 py-0.5 text-xs font-semibold", paper ? modeClass("paper") : modeClass("live"))}>
                          {paper ? "Paper" : modeValue}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        <HashLink hash={execution.tx_hash} mode={modeValue} />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        <HashLink hash={execution.approval_hash} mode={modeValue} />
                      </td>
                      <td className="px-4 py-2 text-[#848E9C]">{getResultString(execution, "provider") ?? "N/A"}</td>
                      <td className="px-4 py-2 text-[#F6465D]">{execution.error ?? "None"}</td>
                    </tr>
                  );
                })}
                {(data?.executions.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-[#848E9C]" colSpan={9}>
                      No executions logged.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Section>

        <Section icon={Radio} title="x402 Cost Panel">
            <div className="rounded-lg border border-[#2B3139] bg-[#1E2329] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric icon={Zap} label="CMC paid call cost" value="0.01 USDC" tone="yellow" />
                <Metric
                  icon={Activity}
                  label="Paid calls"
                  value={
                    typeof data?.x402.paidCallCount === "number"
                      ? formatNumber(data.x402.paidCallCount)
                      : "Not instrumented yet"
                  }
                  tone="slate"
                />
              </div>
              <div className="mt-4 flex items-start gap-3 rounded bg-[#F0B90B]/10 p-3 text-sm text-[#F0B90B]">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <span>Dashboard refreshes must not trigger CMC/x402 calls.</span>
              </div>

              <div className="mt-5 border-t border-[#2B3139] pt-4">
                <div className="mb-3 text-sm font-medium text-[#848E9C]">Telemetry files</div>
                <div className="grid gap-2">
                  {Object.entries(data?.files ?? {}).map(([key, file]) => (
                    <div key={key} className="grid gap-2 rounded border border-[#2B3139] bg-[#181A20] px-3 py-2 text-sm sm:grid-cols-[150px_90px_1fr]">
                      <span className="font-medium text-[#EAECEF]">{key}</span>
                      <span className={file.exists ? "text-[#0ECB81]" : "text-[#F6465D]"}>{file.exists ? "present" : "missing"}</span>
                      <span className="truncate text-[#848E9C]" title={file.path}>
                        {file.modifiedAt ? <TimeValue value={file.modifiedAt} /> : file.error ?? file.path}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
        </Section>
      </div>
    </main>
  );
}
