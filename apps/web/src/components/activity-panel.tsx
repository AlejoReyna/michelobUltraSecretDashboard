"use client";
import { useState, useMemo } from "react";
import { Check, X, ArrowLeft, ArrowRight } from "lucide-react";

// ── Types ───────────────────────────────────────────────────
export type ActivityView = "txs" | "sys";
export type ActivityRow = {
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
export type LogEventDetails = {
  items: Array<{ label: string; value: string; tone?: "green" | "yellow" | "red" }>;
  factors?: Array<{
    key: string;
    label: string;
    passed: boolean;
    reading?: string | null;
  }>;
};
export type StatusPayload = {
  latestDecision?: {
    symbol?: string | null;
    cycle_number?: number | null;
    timestamp?: string | null;
    priced_target_count?: number | null;
    factor_metrics?: Record<string, string | null>;
    reason?: string | null;
  };
  decisions: Array<StatusPayload["latestDecision"] & { action?: string; factor_scores?: Record<string, unknown> }>;
  health: { agentRunning?: boolean };
};
export type ScanFactor = {
  key: string;
  label: string;
  passed: boolean;
  reading?: string | null;
};

// ── Utilities ──────────────────────────────────────────────
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function TokenIcon({ symbol, size }: { symbol: string; size: number }) {
  return (
    <div
      className="rounded-full bg-gradient-to-b from-[#1E1E26] to-[#0C0C0F] border border-[#282830] flex items-center justify-center overflow-hidden shrink-0"
      style={{ width: size, height: size }}
    >
      <span className="text-[10px] font-bold text-[#7F7F94]">{symbol.slice(0, 3)}</span>
    </div>
  );
}

function formatOpenedAt(timestamp: string | null) {
  if (!timestamp) return "N/A";
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function activityStatusGlyph(status: string): string | null {
  switch (status.toUpperCase()) {
    case "ENTER": return "▲";
    case "WAIT": return "○";
    case "HALT": return "■";
    case "SUCCESS": return "✓";
    default: return null;
  }
}

function statusToneTextClass(tone: "green" | "yellow" | "red") {
  return { green: "text-[#33C28E]", yellow: "text-[#CCCDDA]", red: "text-[#E05B73]" }[tone];
}

// ── Components ─────────────────────────────────────────────

function ActivityStatusIndicator({ status, tone }: { status: string; tone: "green" | "yellow" | "red" }) {
  const glyph = activityStatusGlyph(status);
  return (
    <span className={cx("font-sans font-bold text-[14px]", statusToneTextClass(tone))}>
      {glyph ?? status}
    </span>
  );
}

function StaticFactorList({ factors }: { factors: ScanFactor[] }) {
  return (
    <ul className="space-y-3">
      {factors.map((factor) => {
        const pass = factor.passed;
        return (
          <li
            key={factor.key}
            className="group flex items-center gap-4 rounded-xl border border-[#161619] bg-[#111114]/40 px-4 py-3 transition-all hover:border-[#1E1E26] hover:bg-[#111114]/60"
          >
            {/* Left Status Icon */}
            <div className={cx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
              pass ? "border-[#33C28E]/20 bg-[#33C28E]/10 text-[#33C28E]" : "border-[#E05B73]/20 bg-[#E05B73]/10 text-[#E05B73]"
            )}>
              {pass ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
            </div>

            {/* Content */}
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate font-sans text-[13px] font-bold uppercase tracking-wider text-white">
                {factor.label}
              </span>
              {factor.reading && (
                <span className="truncate font-sans text-[11px] text-[#7F7F94]">
                  {factor.reading}
                </span>
              )}
            </div>

            {/* Right Status Tag */}
            <div className={cx(
              "rounded-md border px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-tighter",
              pass ? "border-[#33C28E]/30 bg-[#33C28E]/10 text-[#33C28E]" : "border-[#E05B73]/30 bg-[#E05B73]/10 text-[#E05B73]"
            )}>
              {pass ? "PASS" : "FAIL"}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SimpleLiveScan({
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

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex justify-end pb-12">
        <button
          onClick={onViewPast}
          className="group flex items-center gap-2 border border-[#161619] bg-[#111114]/50 px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.2em] text-[#CCCDDA] transition-all hover:border-[#282830] hover:text-white"
        >
          View Past History <ArrowRight size={14} className="text-[#7F7F94] group-hover:text-white" />
        </button>
      </div>

      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <div className="absolute -inset-4 rounded-full bg-white/5 blur-2xl" />
          <TokenIcon symbol={symbol} size={110} />
        </div>

        <h2 className="mt-8 font-sans text-[32px] font-bold tracking-tight text-white">
          {symbol}/USDT
        </h2>

        <div className="mt-2 flex items-center gap-3 font-sans text-[11px] uppercase tracking-[0.2em] text-[#7F7F94]">
          <span>Cycle #{cycle.toString().padStart(4, '0')}</span>
          <span className="h-1 w-1 rounded-full bg-[#1E1E26]" />
          <span className="flex items-center gap-1">
            <span className="text-[#33C28E]">{passedCount}</span>
            <span className="text-[#282830]">/</span>
            {factors.length} Checks Passed
          </span>
        </div>
      </div>

      <div className="mt-12">
        <StaticFactorList factors={factors} />
      </div>
    </div>
  );
}

function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-sans text-[12px]">
        <thead>
          <tr className="border-b border-[#161619] text-[#7F7F94] uppercase tracking-widest text-[10px]">
            <th className="px-4 py-3 font-bold">Date</th>
            <th className="px-4 py-3 font-bold text-center">Token</th>
            <th className="px-4 py-3 font-bold">Reference</th>
            <th className="px-4 py-3 font-bold text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#161619]">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-[#111114]/40 transition-colors">
              <td className="px-4 py-4 font-bold text-white tabular-nums">{formatOpenedAt(row.timestamp)}</td>
              <td className="px-4 py-4">
                <div className="flex justify-center items-center gap-2">
                  {row.token && <TokenIcon symbol={row.token} size={16} />}
                  <span className="text-[#CCCDDA]">{row.token}</span>
                </div>
              </td>
              <td className="px-4 py-4">
                <a href={row.explorerUrl ?? "#"} className="font-bold text-[#9E88F0] hover:text-white transition-colors">
                  {row.hash}
                </a>
              </td>
              <td className="px-4 py-4 text-center">
                <ActivityStatusIndicator status={row.status} tone={row.tone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ActivityPanel({
  activityRows = [],
  latestDecision,
  agentRunning = true,
}: {
  activityRows?: ActivityRow[];
  latestDecision?: StatusPayload["latestDecision"];
  agentRunning?: boolean;
}) {
  const [_pane, setPane] = useState<"live" | "past">("live");

  return (
    <div className="flex min-h-screen flex-col bg-[#0C0C0F] text-[#CCCDDA] antialiased">
      {/* Slim Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#161619] px-8">
        <div className="flex items-center gap-4">
          <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#7F7F94]">
            Telemetry <span className="mx-2 text-[#282830]">/</span> Live Scan
          </div>
        </div>
        <div className="flex gap-8 font-sans text-[10px] uppercase tracking-widest">
          <div className="flex gap-2">
            <span className="text-[#7F7F94]">Market Cap:</span>
            <span className="text-white">$2.5T</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#7F7F94]">BTC Dom:</span>
            <span className="text-white">45%</span>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-8 py-10 lg:flex-row lg:gap-12">
        {/* Left: Signal Column */}
        <section className="flex flex-1 flex-col">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="font-sans text-[24px] font-bold text-white tracking-tight">Signal Analysis</h1>
            {agentRunning && (
              <div className="flex items-center gap-2 rounded-full border border-[#33C28E]/20 bg-[#33C28E]/10 px-3 py-1">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#33C28E]" />
                <span className="font-sans text-[9px] font-bold uppercase tracking-wider text-[#33C28E]">Agent Active</span>
              </div>
            )}
          </div>

          <div className="flex-1 rounded-2xl border border-[#161619] bg-[#111114]/20 p-8 shadow-2xl backdrop-blur-sm">
            <SimpleLiveScan
              latestDecision={latestDecision}
              onViewPast={() => setPane("past")}
            />
          </div>
        </section>

        {/* Right: Activity Column */}
        <section className="mt-12 flex flex-1 flex-col lg:mt-0">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-sans text-[20px] font-bold text-white tracking-tight">Recent Activity</h2>
            <div className="flex gap-4">
              <button className="border-b-2 border-white pb-1 font-sans text-[11px] font-bold text-white uppercase tracking-widest">Sys Logs</button>
              <button className="pb-1 font-sans text-[11px] font-bold text-[#7F7F94] uppercase tracking-widest hover:text-white transition-colors">Tx Activity</button>
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-[#161619] bg-[#111114]/20 shadow-2xl backdrop-blur-sm overflow-hidden">
            <RecentActivity rows={activityRows} />

            {/* Paginator */}
            <div className="flex items-center justify-between border-t border-[#161619] bg-[#0C0C0F]/40 px-6 py-4 font-sans text-[10px] uppercase tracking-widest text-[#7F7F94]">
              <span>Rows per page: 10</span>
              <div className="flex items-center gap-4">
                <button className="flex items-center gap-1 hover:text-white transition-colors"><ArrowLeft size={12} /> Prev</button>
                <span className="text-white">1 - 10 of 150</span>
                <button className="flex items-center gap-1 hover:text-white transition-colors">Next <ArrowRight size={12} /></button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
