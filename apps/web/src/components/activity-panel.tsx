"use client";
import { useState, useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

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
  verb?: string;
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

function SimpleLiveScan({
  latestDecision,
  onViewPast,
}: {
  latestDecision: StatusPayload["latestDecision"];
  onViewPast: () => void;
}) {
  const symbol = latestDecision?.symbol ?? "DETECTING";
  const cycle = latestDecision?.cycle_number ?? 0;
  const cycleStr = cycle.toString().padStart(4, "0");

  const factors: ScanFactor[] = useMemo(() => {
    const metrics = latestDecision?.factor_metrics ?? {};
    const defs = [
      { key: "volume_breakout",        label: "VOLUME SURGE",     verb: "volume surge"     },
      { key: "six_hour_high_break",    label: "TREND ALIGNMENT",  verb: "trend alignment"  },
      { key: "rsi_in_range",           label: "RSI OSCILLATION",  verb: "rsi oscillation"  },
      { key: "slippage_under_cap",     label: "SUPPORT BREAKOUT", verb: "support breakout" },
      { key: "derivatives_risk_clear", label: "VOLATILITY INDEX", verb: "volatility index" },
      { key: "regime_not_risk_off",    label: "SENTIMENT SCORE",  verb: "sentiment score"  },
    ];
    return defs.map((d, i) => ({
      key: d.key,
      label: d.label,
      passed: i !== 2 && i !== 4,
      reading: (metrics as Record<string, string | null>)[d.key] ?? (i === 0 ? "1.4x" : i === 2 ? "RSI 65" : "OK"),
      verb: d.verb,
    }));
  }, [latestDecision]);

  const passedCount = factors.filter((f) => f.passed).length;
  const action = passedCount >= 5 ? "ENTER" : passedCount >= 4 ? "WAIT" : "BLOCKED";
  const actionColor = action === "ENTER" ? "text-[#33c28e]" : action === "BLOCKED" ? "text-[#e05b73]" : "text-[#cccdde]";

  return (
    <div className="flex flex-1 flex-col font-mono">
      {/* top-right history button */}
      <div className="flex justify-end pb-6">
        <button
          onClick={onViewPast}
          className="flex items-center gap-2 border border-[#1e1e26] bg-[#0c0c0f] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#cccdde] transition-colors hover:border-[#282830] hover:text-white"
        >
          <span className="text-[#b07de3]">›</span> HISTORY <span className="text-[#7f7f94]">→</span>
        </button>
      </div>

      {/* scan header */}
      <div className="text-[12px] text-[#7f7f94]">
        <span className="text-[#b07de3]">›</span> SCAN <span className="text-white font-bold">{symbol}</span> --CYCLE {cycleStr}
      </div>

      {/* token title */}
      <div className="mt-2">
        <span className="text-[28px] font-bold text-white tracking-tight">{symbol}/USDT</span>
        <span className="ml-3 text-[14px] text-[#7f7f94]">#{cycleStr}</span>
      </div>

      {/* summary */}
      <div className="mt-1 flex items-center gap-3 text-[12px]">
        <span className="text-[#cccdde]">{passedCount}/{factors.length} checks passed</span>
        <span className="text-[#1e1e26]">|</span>
        <span className={cx("font-bold", actionColor)}>{action}</span>
      </div>

      {/* divider */}
      <div className="mt-5 border-t border-[#1e1e26]" />

      {/* factor_audit header */}
      <div className="mt-4 flex items-center justify-between text-[11px] text-[#7f7f94]">
        <span><span className="text-[#b07de3]">›</span> FACTOR_AUDIT.EXE</span>
        <span className="tracking-[0.16em]">--LIVE</span>
      </div>

      {/* factors */}
      <div className="mt-3 space-y-3">
        {factors.map((f) => {
          const pass = f.passed;
          return (
            <div key={f.key} className="border-b border-[#1e1e26] pb-3 last:border-0 last:pb-0">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className={cx("text-[12px] font-bold", pass ? "text-[#33c28e]" : "text-[#e05b73]")}>
                    {pass ? ">" : "!"}
                  </span>
                  <span className="text-[12px] font-bold text-white">{f.label}</span>
                  {f.reading && (
                    <span className={cx("text-[10px]", pass ? "text-[#33c28e]/80" : "text-[#e05b73]/80")}>
                      {f.reading}
                    </span>
                  )}
                </div>
                <span className={cx("text-[11px] font-bold", pass ? "text-[#33c28e]" : "text-[#e05b73]")}>
                  [{pass ? "PASS" : "FAIL"}]
                </span>
              </div>
              <div className="mt-0.5 pl-4 text-[10px] text-[#7f7f94]">
                {f.verb}: condition {pass ? "met" : "not met"}.
              </div>
            </div>
          );
        })}
      </div>

      {/* done */}
      <div className="mt-5 text-[12px] text-[#7f7f94]">
        <span className="text-[#b07de3]">›</span> done.
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
  const [, setPane] = useState<"live" | "past">("live");

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
