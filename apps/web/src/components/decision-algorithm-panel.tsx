"use client";

import { useState } from "react";
import {
  ViewportReveal,
  chapterRevealVariant,
  factorRevealVariant,
  outcomeRevealVariant,
} from "@/components/viewport-reveal";
import {
  BREAKOUT_ENTRY_SCORE_MAX,
  BREAKOUT_ENTRY_SCORE_MIN,
  BREAKOUT_QUOTE_SCORE_FLOOR,
  ENTRY_FACTOR_KEYS,
  breakoutEntryScoreStats,
  entryFactorStats,
  resolveStrategyMode,
  type EntryFactorKey,
} from "@/lib/factor-scoring";
import {
  SCALPING_ENTRY_SCORE_MAX,
  SCALPING_ENTRY_SCORE_MIN,
  scalpingFactorStats,
  type ScalpingFactorKey,
} from "@/lib/scalping-scoring";
import type { StatusPayload } from "@/lib/schemas";

type FactorMeta = {
  key: EntryFactorKey;
  title: string;
  plain: string;
  detail: string;
  dataSource: string;
};

const ENTRY_FACTORS: FactorMeta[] = [
  {
    key: "volume_breakout",
    title: "Volume breakout · 25 pts",
    plain: "More people are trading this token than usual.",
    detail:
      "Recent trading volume is significantly above its recent average. The stronger the surge, the more of this 25-point component the candidate earns.",
    dataSource: "CoinMarketCap price & volume history",
  },
  {
    key: "six_hour_high_break",
    title: "Reference high break · 35 pts",
    plain: "Price pushed above a recent ceiling.",
    detail:
      "The bot compares price against 3h, 6h, and 24h highs. Clearing larger windows adds more breakout strength, while a move more than 4% beyond the broken high is treated as too chased.",
    dataSource: "3h / 6h / 24h reference highs",
  },
  {
    key: "regime_not_risk_off",
    title: "Macro context · 5 pts + size",
    plain: "Macro conditions tune the score and position size.",
    detail:
      "Macro breadth contributes a small score component and also scales position size. Defensive conditions shrink the trade instead of acting as a simple buy/no-buy switch.",
    dataSource: "BTC trend, market breadth & stablecoin flows",
  },
  {
    key: "slippage_under_cap",
    title: "Slippage hard gate",
    plain: "The quoted route must not cost too much in price impact.",
    detail:
      "TWAK quoting is reserved for candidates near the entry threshold. Once quoted, slippage is still binary: missing, negative, or above-cap slippage blocks entry even if the score is high.",
    dataSource: "TWAK / LiquidMesh route quote",
  },
  {
    key: "rsi_in_range",
    title: "RSI in range · 10 pts",
    plain: "Momentum is healthy—not exhausted or crashing.",
    detail:
      "RSI (Relative Strength Index) measures how stretched a move is on a 0–100 scale. In-range RSI contributes points; missing data contributes zero rather than silently passing.",
    dataSource: "14-period RSI on recent candles",
  },
  {
    key: "derivatives_risk_clear",
    title: "Derivatives risk clear · 10 pts",
    plain: "Futures markets are not flashing danger signals.",
    detail:
      "Extreme funding rates or crowded leveraged positions can foreshadow sharp reversals. Clean derivatives risk adds points; missing or elevated risk contributes zero.",
    dataSource: "Funding rates & derivatives metrics",
  },
];

const CYCLE_STEPS = [
  {
    step: "01",
    title: "Wake up",
    body: "Every cycle, the agent wakes up, reads wallet balances, and loads open positions from disk.",
  },
  {
    step: "02",
    title: "Scan targets",
    body: "It pulls fresh market data (via CoinMarketCap / x402) for every token on the competition allowlist—often dozens of symbols per cycle.",
  },
  {
    step: "03",
    title: "Score entries",
    body: "Stablecoins and gold tokens are excluded up front, then each candidate gets a weighted 0–100 entry score: breakout strength 35, volume 25, momentum 15, RSI 10, derivatives 10, macro 5.",
  },
  {
    step: "04",
    title: "Apply guardrails",
    body: "Candidates below the quote floor are logged immediately. Near-threshold candidates get a TWAK quote, then slippage, daily limits, drawdown, disk health, and kill-switch guardrails decide whether money can move.",
  },
  {
    step: "05",
    title: "Decide & act",
    body: "Entry requires score ≥ 45 plus slippage under cap. If no trade has fired by 22:00 UTC, a tiny compliance swap keeps the competition's one-trade-per-day minimum.",
  },
];

type ExampleDecision = NonNullable<StatusPayload["latestDecision"]>;

const SIMULATED_PASSING_SIGNAL: ExampleDecision = {
  timestamp: "2026-06-06T14:22:00.000Z",
  cycle_number: 142,
  mode: "paper",
  portfolio_value_usdc: 1156.89,
  position_count: 1,
  entries_allowed: true,
  action: "ENTER",
  symbol: "CAKE",
  position_size_usdc: 75,
  strategy_mode: "breakout",
  entry_score: 80,
  entries_blocked_reason: null,
  factor_scores: {
    volume_breakout: true,
    six_hour_high_break: true,
    regime_not_risk_off: true,
    slippage_under_cap: true,
    rsi_in_range: true,
    derivatives_risk_clear: true,
  },
  true_factor_count: 6,
  estimated_slippage_pct: 0.0018,
  reason: "entry score 80.0 >= 45.0; slippage under cap (6/6 factors true)",
  priced_target_count: 149,
};

const SIMULATED_NON_PASSING_SIGNAL: ExampleDecision = {
  timestamp: "2026-06-06T14:18:00.000Z",
  cycle_number: 141,
  mode: "paper",
  portfolio_value_usdc: 1142.33,
  position_count: 1,
  entries_allowed: true,
  action: "WAIT",
  symbol: "LINK",
  position_size_usdc: 0,
  strategy_mode: "breakout",
  entry_score: 42,
  entries_blocked_reason: null,
  factor_scores: {
    volume_breakout: true,
    six_hour_high_break: false,
    regime_not_risk_off: true,
    slippage_under_cap: true,
    rsi_in_range: true,
    derivatives_risk_clear: true,
  },
  true_factor_count: 5,
  estimated_slippage_pct: 0.0011,
  reason: "entry score 42.0 below threshold 45.0",
  priced_target_count: 149,
};

type GuideStrategyMode = "breakout" | "scalping";

type ScalpingFactorMeta = {
  key: ScalpingFactorKey;
  title: string;
  weight: number;
  plain: string;
  detail: string;
  dataSource: string;
};

const SCALPING_FACTOR_META: ScalpingFactorMeta[] = [
  {
    key: "micro_momentum",
    title: "Micro-momentum",
    weight: 30,
    plain: "Price above EMA(9) with elevated 5m volume.",
    detail:
      "The token must trade above its 9-period EMA while recent 5-minute volume exceeds 1.5× the rolling hourly average. This targets short bursts—not slow overnight drifts.",
    dataSource: "Price cache + CMC volume (trial every 5m, x402 every 2h)",
  },
  {
    key: "slippage_ok",
    title: "Slippage OK",
    weight: 25,
    plain: "Estimated slippage stays under 0.3%.",
    detail:
      "Before scoring, the bot reads estimated swap slippage from enriched market data. Above 0.3% this factor fails—even if the hard entry gate allows up to 0.5%.",
    dataSource: "x402-enriched snapshot + TWAK quote at execution",
  },
  {
    key: "regime_neutro",
    title: "Regime neutral",
    weight: 20,
    plain: "Market is not in risk-off mode.",
    detail:
      "When BNB trend and sentiment turn defensive, new scalps are riskier. This factor confirms the macro backdrop is neutral or risk-on—not a broad selloff.",
    dataSource: "BNB regime detector + sentiment tier-1",
  },
  {
    key: "no_whale_dump",
    title: "No whale dump",
    weight: 15,
    plain: "Token is not down more than 2% in the last hour.",
    detail:
      "A sharp 1-hour drawdown often signals distribution or a liquidity vacuum. The bot skips tokens that dropped more than 2% in the last hour.",
    dataSource: "CMC percent_change_1h (trial overlay)",
  },
  {
    key: "gas_viable",
    title: "Gas viable",
    weight: 10,
    plain: "BSC gas is below 5 gwei.",
    detail:
      "With a small portfolio, gas can eat the entire edge. This factor blocks entries when BSC gas exceeds the configured ceiling (default 5 gwei).",
    dataSource: "BSC RPC eth_gasPrice",
  },
];

const SCALPING_CYCLE_INPUTS = [
  "Market data (trial 5m + x402 2h)",
  "Weighted score 0–100",
  "Scalping guardrails",
  "TWAK swap execution",
  "Fixed TP / SL / time stop",
  "Decision log",
];

const SCALPING_CYCLE_STEPS = [
  {
    step: "01",
    title: "Wake up",
    body: "Every 5 minutes the agent reads wallet balances, open positions, and guardrail state.",
  },
  {
    step: "02",
    title: "Dual data fetch",
    body: "Trial REST refreshes prices every cycle; paid x402 plus free metrics enriches slippage and funding every 2 hours.",
  },
  {
    step: "03",
    title: "Score universe",
    body: "Each allowlisted token gets five weighted checks. Points add up—60+ can enter, below 60 logs the best near-miss.",
  },
  {
    step: "04",
    title: "Apply guardrails",
    body: "Daily loss cap, trade limits, max one open scalp, and cooldown after consecutive stops can still block a high score.",
  },
  {
    step: "05",
    title: "Enter or exit",
    body: "ENTER swaps USDC → token via TWAK. Open positions exit at +1.5% TP, −0.8% SL, or a 20–30 min time stop.",
  },
];

const SCALPING_FLOW_STEPS = [
  { label: "New cycle", sub: "Read wallet & positions" },
  { label: "Refresh data", sub: "Keyless quotes + x402 cache" },
  { label: "Score 5 factors", sub: "Weighted 0–100 per token" },
  { label: "Score ≥ 60?", sub: "Best candidate + guardrails" },
  { label: "ENTER or WAIT", sub: "Swap or log near-miss" },
];

const SCALPING_OUTCOMES = [
  {
    action: "ENTER",
    summary: "Scalp opened",
    body: "Best token scored ≥ 60/100, guardrails allow entries, and TWAK accepts the swap size. One position max—no stacking scalps.",
  },
  {
    action: "WAIT",
    summary: "Below threshold",
    body: "The top candidate scored under 60 (e.g. 45/100). The dashboard shows which factors passed and how many points each contributed.",
  },
  {
    action: "BLOCKED",
    summary: "Guardrail stop",
    body: "Score may look fine, but daily loss cap, trade limit, cooldown, or max-position rule vetoed the entry.",
  },
  {
    action: "EXIT",
    summary: "Position closed",
    body: "Take profit (+1.5%), stop loss (−0.8%), or time stop fired. Token swaps back to USDC and a symbol cooldown begins.",
  },
];

const SIMULATED_SCALPING_SIGNAL: ExampleDecision = {
  timestamp: "2026-06-06T14:25:00.000Z",
  cycle_number: 143,
  mode: "paper",
  portfolio_value_usdc: 1156.89,
  position_count: 0,
  entries_allowed: true,
  action: "ENTER",
  symbol: "CAKE",
  position_size_usdc: 11.57,
  strategy_mode: "scalping",
  entry_score: 65,
  factor_scores: {
    micro_momentum: true,
    slippage_ok: true,
    regime_neutro: true,
    no_whale_dump: true,
    gas_viable: false,
  },
  true_factor_count: 3,
  estimated_slippage_pct: 0.001,
  reason: "scalping score 65/100 >= 60",
  priced_target_count: 149,
};

const SIMULATED_SCALPING_WAIT: ExampleDecision = {
  timestamp: "2026-06-07T08:55:00.000Z",
  cycle_number: 2,
  mode: "live",
  portfolio_value_usdc: 7.11,
  position_count: 0,
  entries_allowed: true,
  action: "WAIT",
  symbol: "TRX",
  position_size_usdc: 0,
  strategy_mode: "scalping",
  entry_score: 45,
  factor_scores: {
    micro_momentum: false,
    slippage_ok: false,
    regime_neutro: true,
    no_whale_dump: true,
    gas_viable: true,
  },
  true_factor_count: 2,
  estimated_slippage_pct: null,
  reason: "best TRX scalping score 45/100 < 60",
  priced_target_count: 117,
};

const CYCLE_INPUTS = [
  "Market data (CMC / x402)",
  "Weighted entry score 0–100",
  "TWAK slippage hard gate",
  "Guardrails & limits",
  "Position tracking",
  "Decision log",
];

const OUTCOMES = [
  {
    action: "ENTER",
    summary: "Buy approved",
    body: "Entry score is at least 45, TWAK slippage is under cap, and guardrails allow new entries. The agent applies the macro size multiplier and executes a USDC → token swap.",
  },
  {
    action: "WAIT",
    summary: "Keep watching",
    body: "The score is below threshold, below the quote floor, slippage is not acceptable, or the move is too chased. No money moves; the reason is logged for the next cycle.",
  },
  {
    action: "BLOCKED",
    summary: "Guardrail stop",
    body: "Score and slippage may look good, but a safety rule vetoed the trade: daily loss budget, trade caps, free disk floor, kill switch, or entries disabled.",
  },
  {
    action: "HALT",
    summary: "Full stop",
    body: "Critical failure or manual halt. The agent stops opening new positions until the condition clears.",
  },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function ChapterDivider({
  number,
  title,
  subtitle,
  chapterIndex,
}: {
  number: string;
  title: string;
  subtitle?: string;
  chapterIndex: number;
}) {
  return (
    <div className="guide-chapter-divider" role="separator" aria-label={`Chapter ${number}: ${title}`}>
      <div className="guide-chapter-divider__meta">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
          Ch. {number}
        </span>
        <ViewportReveal variant="expand" duration="slow" delay={60} className="guide-chapter-divider__line" />
      </div>
      <div>
        <h2 className="font-mono text-sm font-semibold text-white">{title}</h2>
        {subtitle ? (
          <p className="mt-1 font-mono text-[11px] leading-5 text-[#757575]">{subtitle}</p>
        ) : null}
      </div>
      <ViewportReveal
        variant="expand"
        duration="slow"
        delay={100 + chapterIndex * 20}
        className="guide-chapter-divider__rule"
      />
    </div>
  );
}

function GuideStrategyToggle({
  mode,
  onChange,
}: {
  mode: GuideStrategyMode;
  onChange: (mode: GuideStrategyMode) => void;
}) {
  return (
    <div
      className="mt-4 inline-flex border border-[#2A2A2A] bg-[#0A0A0A] p-0.5"
      role="tablist"
      aria-label="Strategy guide mode"
    >
      {(
        [
          { id: "breakout" as const, label: "Breakout" },
          { id: "scalping" as const, label: "Scalping" },
        ] as const
      ).map((option) => {
        const active = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cx(
              "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
              active ? "bg-[#111] text-white" : "text-[#666] hover:text-[#A8A8A8]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function CycleOverviewList({ items }: { items: string[] }) {
  const itemVariants = ["right", "fade", "left", "up", "down", "scale"] as const;

  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <ViewportReveal
          key={item}
          as="li"
          variant={itemVariants[index % itemVariants.length]}
          delay={index * 45}
          duration="fast"
          className="list-none"
        >
          <div className="flex items-start gap-3 border border-[#1A1A1A] bg-black/60 px-3 py-2.5">
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#555]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="font-mono text-[11px] leading-5 text-[#CFCFCF]">{item}</span>
          </div>
        </ViewportReveal>
      ))}
    </ol>
  );
}

function DecisionFlowList({ steps }: { steps: Array<{ label: string; sub: string }> }) {
  const stepVariants = ["down", "fade", "up", "left", "scale"] as const;

  return (
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <ViewportReveal
          key={step.label}
          as="li"
          variant={stepVariants[index % stepVariants.length]}
          delay={index * 50}
          className="list-none"
        >
          <div className="flex items-start gap-3 border border-[#1A1A1A] bg-[#0A0A0A] px-3 py-2.5">
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#555]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-semibold text-white">{step.label}</div>
              <p className="mt-0.5 font-mono text-[10px] leading-4 text-[#757575]">{step.sub}</p>
            </div>
          </div>
        </ViewportReveal>
      ))}
    </ol>
  );
}

function FactorScoreBar({ passed, total }: { passed: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cx(
            "h-1.5 flex-1 border",
            i < passed ? "border-[#444] bg-[#666]" : "border-[#1A1A1A] bg-[#0A0A0A]",
          )}
        />
      ))}
    </div>
  );
}

function ScalpingScoreBar({ score, max }: { score: number; max: number }) {
  const filled = Math.max(0, Math.min(max, Math.round(score)));
  return (
    <div className="flex gap-1">
      {Array.from({ length: max / 10 }).map((_, index) => {
        const threshold = (index + 1) * 10;
        const active = filled >= threshold;
        return (
          <div
            key={threshold}
            className={cx(
              "h-1.5 flex-1 border",
              active ? "border-[#444] bg-[#666]" : "border-[#1A1A1A] bg-[#0A0A0A]",
            )}
          />
        );
      })}
    </div>
  );
}

function DecisionSnapshot({
  decision,
  heading = "Latest cycle snapshot",
  badge,
}: {
  decision: ExampleDecision;
  heading?: string;
  badge?: string;
}) {
  const strategyMode = resolveStrategyMode(decision);
  const breakoutStats = entryFactorStats(decision);
  const breakoutScore = breakoutEntryScoreStats(decision);
  const scalpingStats = scalpingFactorStats(decision);
  const action = String(decision.action ?? "WAIT").toUpperCase();
  const resolvedBadge =
    badge ??
    (strategyMode === "scalping"
      ? `${scalpingStats.score}/${scalpingStats.max} · ${action}`
      : breakoutScore.score != null
        ? `${breakoutScore.score}/${breakoutScore.max} · ${action}`
        : `${breakoutStats.passed}/${breakoutStats.total} · ${action}`);

  return (
    <div className="border border-[#2A2A2A] bg-black/88">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A] px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#757575]">{heading}</div>
            <span className="border border-[#2A2A2A] bg-[#0A0A0A] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A8A8A]">
              {strategyMode}
            </span>
            {resolvedBadge ? (
              <span className="border border-[#2A2A2A] bg-[#0A0A0A] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A8A8A]">
                {resolvedBadge}
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-sm text-white">
            {decision.symbol ?? "—"} · cycle #{decision.cycle_number ?? "?"}
          </div>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#A8A8A8]">{action}</span>
      </div>
      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-[#A8A8A8]">
            <span>{strategyMode === "breakout" && breakoutScore.score == null ? "Factor audit" : "Entry score"}</span>
            <span className="text-white">
              {strategyMode === "scalping"
                ? `${scalpingStats.score}/${scalpingStats.max} required ${SCALPING_ENTRY_SCORE_MIN}+`
                : breakoutScore.score != null
                  ? `${breakoutScore.score}/${breakoutScore.max} required ${BREAKOUT_ENTRY_SCORE_MIN}+`
                : `${breakoutStats.passed}/${breakoutStats.total} required`}
            </span>
          </div>
          {strategyMode === "scalping" ? (
            <ScalpingScoreBar score={scalpingStats.score} max={SCALPING_ENTRY_SCORE_MAX} />
          ) : breakoutScore.score != null ? (
            <ScalpingScoreBar score={breakoutScore.score} max={BREAKOUT_ENTRY_SCORE_MAX} />
          ) : (
            <FactorScoreBar passed={breakoutStats.passed} total={breakoutStats.total} />
          )}
        </div>
        <div className="font-mono text-[11px] leading-5 text-[#A8A8A8]">
          <span className="text-[#757575]">Reason: </span>
          <span className="text-[#DADADA]">{decision.reason?.trim() || "—"}</span>
          {strategyMode === "breakout" ? (
            <div className="mt-2">
              <span className="text-[#757575]">Slippage gate: </span>
              <span className={breakoutScore.slippageMet ? "text-[#DADADA]" : "text-[#FF7373]"}>
                {breakoutScore.slippageMet ? "under cap" : "missing or above cap"}
              </span>
            </div>
          ) : null}
          {decision.entries_blocked_reason ? (
            <div className="mt-2">
              <span className="text-[#757575]">Blocked: </span>
              <span className="text-[#FF7373]">{decision.entries_blocked_reason}</span>
            </div>
          ) : null}
          {decision.exit_reason ? (
            <div className="mt-2">
              <span className="text-[#757575]">Exit: </span>
              <span className="text-[#DADADA]">{decision.exit_reason}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 border-t border-[#1A1A1A] px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {strategyMode === "scalping"
          ? SCALPING_FACTOR_META.map((factor) => {
              const passed = Boolean(decision.factor_scores?.[factor.key]);
              return (
                <div
                  key={factor.key}
                  className={cx(
                    "flex items-start gap-2 border px-3 py-2 font-mono text-[11px]",
                    passed ? "border-[#333] bg-[#111] text-[#DADADA]" : "border-[#1A1A1A] text-[#666]",
                  )}
                >
                  <span className={passed ? "text-[#8A8A8A]" : "text-[#333]"} aria-hidden>
                    {passed ? "—" : "·"}
                  </span>
                  <span>
                    {factor.title} ({factor.weight} pts)
                  </span>
                </div>
              );
            })
          : ENTRY_FACTOR_KEYS.map((key) => {
              const meta = ENTRY_FACTORS.find((f) => f.key === key);
              const passed = Boolean(decision.factor_scores?.[key]);
              return (
                <div
                  key={key}
                  className={cx(
                    "flex items-start gap-2 border px-3 py-2 font-mono text-[11px]",
                    passed ? "border-[#333] bg-[#111] text-[#DADADA]" : "border-[#1A1A1A] text-[#666]",
                  )}
                >
                  <span className={passed ? "text-[#8A8A8A]" : "text-[#333]"} aria-hidden>
                    {passed ? "—" : "·"}
                  </span>
                  <span>{meta?.title ?? key}</span>
                </div>
              );
            })}
      </div>
    </div>
  );
}

function LiveSnapshot({ decision }: { decision: StatusPayload["latestDecision"] }) {
  if (!decision) {
    return (
      <div className="border border-[#2A2A2A] bg-[#0A0A0A] px-5 py-6 font-mono text-[12px] text-[#8A8A8A]">
        No live decision telemetry yet. When the agent runs, the latest cycle appears here.
      </div>
    );
  }

  return <DecisionSnapshot decision={decision} />;
}

function FactorCard({ factor, index }: { factor: FactorMeta; index: number }) {
  return (
    <article className="flex flex-col border border-[#2A2A2A] bg-black/88">
      <div className="flex items-start gap-3 border-b border-[#1A1A1A] px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center border border-[#2A2A2A] bg-[#0A0A0A] font-mono text-[11px] text-[#757575]">
          {index + 1}
        </span>
        <div>
          <h3 className="font-mono text-sm font-semibold text-white">{factor.title}</h3>
          <p className="mt-1 font-mono text-[12px] leading-5 text-[#A8A8A8]">{factor.plain}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <p className="font-mono text-[11px] leading-5 text-[#B0B0B0]">{factor.detail}</p>
        <p className="mt-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[#666]">
          Source: {factor.dataSource}
        </p>
      </div>
    </article>
  );
}

function ScalpingFactorCard({ factor, index }: { factor: ScalpingFactorMeta; index: number }) {
  return (
    <article className="flex flex-col border border-[#2A2A2A] bg-black/88">
      <div className="flex items-start gap-3 border-b border-[#1A1A1A] px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center border border-[#2A2A2A] bg-[#0A0A0A] font-mono text-[11px] text-[#757575]">
          {index + 1}
        </span>
        <div>
          <h3 className="font-mono text-sm font-semibold text-white">
            {factor.title} · {factor.weight} pts
          </h3>
          <p className="mt-1 font-mono text-[12px] leading-5 text-[#A8A8A8]">{factor.plain}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <p className="font-mono text-[11px] leading-5 text-[#B0B0B0]">{factor.detail}</p>
        <p className="mt-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[#666]">
          Source: {factor.dataSource}
        </p>
      </div>
    </article>
  );
}

export function DecisionAlgorithmPanel({
  latestDecision,
  compact = false,
  desktop = false,
}: {
  latestDecision: StatusPayload["latestDecision"];
  compact?: boolean;
  desktop?: boolean;
}) {
  const wideLayout = desktop || !compact;
  const chapterGap = compact ? "mt-8" : desktop ? "mt-10" : "mt-12";
  const panelClass = "border border-[#2A2A2A] bg-black/88 p-4";
  const [guideMode, setGuideMode] = useState<GuideStrategyMode>(() =>
    latestDecision ? resolveStrategyMode(latestDecision) : "scalping",
  );
  const isScalping = guideMode === "scalping";
  const cycleInputs = isScalping ? SCALPING_CYCLE_INPUTS : CYCLE_INPUTS;
  const cycleSteps = isScalping ? SCALPING_CYCLE_STEPS : CYCLE_STEPS;
  const flowSteps = isScalping ? SCALPING_FLOW_STEPS : [
    { label: "New cycle", sub: "Read wallet & positions" },
    { label: "Scan allowlist", sub: "~149 BEP-20 tokens" },
    { label: "Score 0–100", sub: "Cheap candidate ranking" },
    { label: "Quote slippage", sub: `Score ${BREAKOUT_QUOTE_SCORE_FLOOR}+` },
    { label: "ENTER or WAIT", sub: "Swap or log & retry" },
  ];
  const outcomes = isScalping ? SCALPING_OUTCOMES : OUTCOMES;
  const scalpingGuardrails = [
    {
      title: "One position max",
      body: "Scalping mode holds at most one open trade. While a position is live, the bot monitors exits instead of hunting new entries.",
    },
    {
      title: "Daily loss cap (2%)",
      body: "Realized scalping losses are capped per day. Breaching the budget pauses new entries until the next window.",
    },
    {
      title: "Daily trade limit",
      body: "Up to 10 scalp entries per day by default—prevents over-trading when scores flicker around the 60-point threshold.",
    },
    {
      title: "Consecutive-loss cooldown",
      body: "Three stops in a row trigger a 1-hour pause on new entries for that symbol and globally.",
    },
  ];
  const breakoutGuardrails = [
    {
      title: "Macro size multiplier",
      body: "Defensive macro conditions reduce breakout position size instead of acting as a simple veto. The size multiplier is logged with the decision.",
    },
    {
      title: "Daily loss budget",
      body: "Tracks realized losses for the day (`daily_realized_loss`). Prevents revenge trading after a bad session.",
    },
    {
      title: "Daily trade cap",
      body: "Limits how many entries can fire in one day (`daily_trade_count`) to avoid over-trading in choppy markets.",
    },
    {
      title: "Portfolio ATH tracking",
      body: "Monitors all-time-high portfolio value (`portfolio_ath`) for drawdown-aware position sizing.",
    },
    {
      title: "Disk health floor",
      body: "If free disk space drops below the configured floor, new entries are blocked so the bot can keep writing logs and state safely.",
    },
  ];
  const afterEnterSteps = isScalping
    ? [
        {
          step: "01",
          title: "Size the scalp",
          body: "Default ~1% of portfolio in USDC (`scalping_position_pct`). Small sizes limit MEV and gas drag.",
        },
        {
          step: "02",
          title: "Quote & swap",
          body: "TWAK routes USDC → token on BSC with slippage capped at 0.5% for entry.",
        },
        {
          step: "03",
          title: "Fixed exit rules",
          body: "Take profit +1.5%, stop loss −0.8%, time stop 20–30 min. No trailing stop—reduces MEV gaming.",
        },
      ]
    : [
        {
          step: "01",
          title: "Size the trade",
          body: "Position size in USDC is computed from portfolio value, risk rules, and the macro `position_size_multiplier`.",
        },
        {
          step: "02",
          title: "Quote & swap",
          body: "TWAK routes through LiquidMesh on BSC with a max slippage cap (`max_slippage_pct`).",
        },
        {
          step: "03",
          title: "Track the position",
          body: "Entry price, stepped trailing stop, and take-profit levels are written to `positions.json` and shown on the Active Positions tab. Breakout trailing starts wider, then tightens after +8% and +12%.",
        },
      ];

  return (
    <section
      className={cx(
        "console-scroll flex min-h-0 flex-col overflow-y-auto",
        compact && "flex-1 px-4 pt-4 pb-8",
        desktop && "flex-1 px-8 pt-6 pb-10",
        !compact && !desktop && "px-10 py-9",
      )}
    >
      <ViewportReveal variant="blur" duration="slow">
        <header
          className={cx(
            wideLayout ? "max-w-none" : "max-w-3xl",
            compact || desktop ? "shrink-0 border-b border-[#1A1A1A] pb-4" : "pb-2",
          )}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy explainer</div>
          <h1
            className={cx(
              "mt-2 font-mono font-semibold leading-tight text-white",
              compact || desktop ? "text-[28px]" : "text-[32px]",
            )}
          >
            {isScalping ? "How Scalping Decisions Work" : "How Buy Decisions Work"}
          </h1>
          {!compact ? (
            <p className="mt-3 max-w-3xl font-mono text-[12px] leading-5 text-[#8A8A8A]">
              {isScalping
                ? "Every 5 minutes the agent refreshes trial market data, scores ~149 tokens on five weighted factors (0–100), and enters when the best score reaches 60+. Exits are fixed—not trailing."
                : "The agent never guesses. On every cycle it gathers market data, computes a weighted breakout entry score, quotes slippage only for near-threshold candidates, applies safety guardrails, and only then swaps USDC for a token."}
            </p>
          ) : null}
          <GuideStrategyToggle mode={guideMode} onChange={setGuideMode} />
        </header>
      </ViewportReveal>

      <div key={guideMode}>
      <div className={chapterGap}>
        <ViewportReveal variant={chapterRevealVariant(0)} delay={40} duration="slow">
          <ChapterDivider
            number="01"
            title="Overview"
            subtitle={
              isScalping
                ? "Dual data feed plus a weighted score. Entry at 60+, not all-or-nothing."
                : "Weighted score first, quote second. Entry needs 45+ and clean slippage."
            }
            chapterIndex={0}
          />
        </ViewportReveal>
        <div className={cx("mt-5 grid gap-4", wideLayout && "xl:grid-cols-2")}>
          <ViewportReveal variant="right" delay={80}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">Big picture</h3>
              <CycleOverviewList items={cycleInputs} />
            </div>
          </ViewportReveal>
          <ViewportReveal variant="left" delay={140}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">
                The rule in one line
              </h3>
              <div className="border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-4">
                {isScalping ? (
                  <>
                    <p className="font-mono text-[18px] font-semibold leading-snug text-white">
                      Best score ≥ {SCALPING_ENTRY_SCORE_MIN}/{SCALPING_ENTRY_SCORE_MAX} to enter
                    </p>
                    <p className="mt-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">
                      Factors have different weights (30, 25, 20, 15, 10 pts). Three factors passing is not enough—e.g.
                      regime + whale + gas = 45/100. Slippage (+25) or micro-momentum (+30) is usually needed to reach 60.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-mono text-[18px] font-semibold leading-snug text-white">
                      Entry score ≥ {BREAKOUT_ENTRY_SCORE_MIN}/{BREAKOUT_ENTRY_SCORE_MAX} + slippage under cap
                    </p>
                    <p className="mt-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">
                      Breakout v3 is additive. Candidates below {BREAKOUT_QUOTE_SCORE_FLOOR}/100 are not quoted;
                      candidates near the threshold get a TWAK route quote. A high score still waits if slippage is
                      missing or above cap, and safety guardrails can still block a valid signal.
                    </p>
                  </>
                )}
              </div>
              <div className="mt-4 space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#757575]">
                  Example score bars
                </div>
                <div className="space-y-3">
                  {isScalping ? (
                    <>
                      <div>
                        <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                          <span>45/100 — WAIT</span>
                          <span>Regime + whale + gas only</span>
                        </div>
                        <ScalpingScoreBar score={45} max={SCALPING_ENTRY_SCORE_MAX} />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                          <span>65/100 — eligible for ENTER</span>
                          <span>Missing gas still OK if ≥ 60</span>
                        </div>
                        <ScalpingScoreBar score={65} max={SCALPING_ENTRY_SCORE_MAX} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                          <span>42/100 — WAIT</span>
                          <span>Below 45 threshold</span>
                        </div>
                        <ScalpingScoreBar score={42} max={BREAKOUT_ENTRY_SCORE_MAX} />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                          <span>80/100 — eligible for ENTER</span>
                          <span>Still needs clean slippage</span>
                        </div>
                        <ScalpingScoreBar score={80} max={BREAKOUT_ENTRY_SCORE_MAX} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </ViewportReveal>
        </div>
      </div>

      <div className={chapterGap}>
        <ViewportReveal variant={chapterRevealVariant(1)} delay={40} duration="slow">
          <ChapterDivider
            number="02"
            title="Cycle flow"
            subtitle={
              isScalping
                ? "Every 5 minutes: refresh data, score, enter or log the best near-miss."
                : "From wake-up to swap—or to a logged wait state."
            }
            chapterIndex={1}
          />
        </ViewportReveal>
        <ViewportReveal className="mt-5" variant="fade" delay={100} duration="slow">
          <div className={panelClass}>
            <div className={cx(wideLayout && "grid gap-6 lg:grid-cols-[minmax(0,220px)_1fr]")}>
              <DecisionFlowList steps={flowSteps} />
              {wideLayout ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:mt-0 lg:grid-cols-1">
                  {cycleSteps.map((step, index) => (
                    <ViewportReveal
                      key={step.step}
                      variant={index % 2 === 0 ? "left" : "right"}
                      delay={160 + index * 55}
                    >
                      <div className="border border-[#1A1A1A] bg-[#0A0A0A] px-3 py-3">
                        <div className="font-mono text-[10px] text-[#555]">{step.step}</div>
                        <div className="mt-1 font-mono text-[12px] font-semibold text-white">{step.title}</div>
                        <p className="mt-1 font-mono text-[10px] leading-4 text-[#757575]">{step.body}</p>
                      </div>
                    </ViewportReveal>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </ViewportReveal>
      </div>

      <div className={chapterGap}>
        <ViewportReveal variant={chapterRevealVariant(2)} delay={40} duration="slow">
          <ChapterDivider
            number="03"
            title={isScalping ? "The five weighted factors" : "The scored factors"}
            subtitle={
              isScalping
                ? "Points add up to 100. Entry when score ≥ 60. Fixed TP +1.5%, SL −0.8%, max hold 30 min."
                : "Score components add up to 100. The yes/no flags remain as a compatibility audit in Activity."
            }
            chapterIndex={2}
          />
        </ViewportReveal>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {isScalping
            ? SCALPING_FACTOR_META.map((factor, index) => (
                <ViewportReveal
                  key={factor.key}
                  variant={factorRevealVariant(index)}
                  delay={80 + index * 50}
                  duration={index % 2 === 0 ? "normal" : "slow"}
                >
                  <ScalpingFactorCard factor={factor} index={index} />
                </ViewportReveal>
              ))
            : ENTRY_FACTORS.map((factor, index) => (
                <ViewportReveal
                  key={factor.key}
                  variant={factorRevealVariant(index)}
                  delay={80 + index * 50}
                  duration={index % 2 === 0 ? "normal" : "slow"}
                >
                  <FactorCard factor={factor} index={index} />
                </ViewportReveal>
              ))}
        </div>
      </div>

      <div className={chapterGap}>
        <ViewportReveal variant={chapterRevealVariant(3)} delay={40} duration="slow">
          <ChapterDivider
            number="04"
            title="Safety & execution"
            subtitle={
              isScalping
                ? "Guardrails can veto a 60+ score. Exits are automatic and fixed."
                : "Guardrails can veto a 45+ score. A buy starts stepped trailing management."
            }
            chapterIndex={3}
          />
        </ViewportReveal>
        <div className={cx("mt-5 grid gap-4", wideLayout && "lg:grid-cols-2")}>
          <ViewportReveal variant="right" delay={90}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">
                Safety guardrails
              </h3>
              <ul className="space-y-2">
                {(isScalping ? scalpingGuardrails : breakoutGuardrails).map((item, index) => (
                  <ViewportReveal
                    key={item.title}
                    as="li"
                    variant={index % 2 === 0 ? "left" : "fade"}
                    delay={120 + index * 50}
                    duration="fast"
                    className="list-none"
                  >
                    <div className="border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3">
                      <div className="font-mono text-[12px] font-semibold text-white">{item.title}</div>
                      <p className="mt-1 font-mono text-[11px] leading-5 text-[#8A8A8A]">{item.body}</p>
                    </div>
                  </ViewportReveal>
                ))}
              </ul>
            </div>
          </ViewportReveal>
          <ViewportReveal variant="left" delay={150}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">
                {isScalping ? "What happens after ENTER" : "What happens after ENTER"}
              </h3>
              <ol className="space-y-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">
                {afterEnterSteps.map((item, index) => (
                  <ViewportReveal
                    key={item.step}
                    as="li"
                    variant={index % 2 === 0 ? "up" : "scale"}
                    delay={180 + index * 55}
                    className="list-none"
                  >
                    <div className="flex gap-3 border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3">
                      <span className="shrink-0 text-[#555]">{item.step}</span>
                      <span>
                        <strong className="text-white">{item.title}</strong> — {item.body}
                      </span>
                    </div>
                  </ViewportReveal>
                ))}
              </ol>
            </div>
          </ViewportReveal>
        </div>
      </div>

      <div className={chapterGap}>
        <ViewportReveal variant={chapterRevealVariant(4)} delay={40} duration="slow">
          <ChapterDivider
            number="05"
            title="Possible outcomes"
            subtitle={
              isScalping
                ? "Four actions each cycle—including automatic exits on open scalps."
                : "Four actions the agent can emit each cycle."
            }
            chapterIndex={4}
          />
        </ViewportReveal>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {outcomes.map((outcome, index) => (
            <ViewportReveal
              key={outcome.action}
              variant={outcomeRevealVariant(index)}
              delay={80 + index * 65}
              duration={index % 2 === 0 ? "normal" : "fast"}
            >
              <div className="border border-[#2A2A2A] bg-black/88 px-4 py-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#757575]">{outcome.action}</div>
                <div className="mt-1 font-mono text-[12px] font-semibold text-white">{outcome.summary}</div>
                <p className="mt-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">{outcome.body}</p>
              </div>
            </ViewportReveal>
          ))}
        </div>
      </div>

      {wideLayout ? (
        <div className={chapterGap}>
          <ViewportReveal variant={chapterRevealVariant(5)} delay={40} duration="slow">
            <ChapterDivider
              number="06"
              title="Examples"
              subtitle={
                isScalping
                  ? "Simulated passing and near-miss scores, plus your latest live cycle."
                  : "Simulated scored breakout decisions, plus your latest live cycle."
              }
              chapterIndex={5}
            />
          </ViewportReveal>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <ViewportReveal variant="scale" delay={100}>
              {isScalping ? (
                <DecisionSnapshot decision={SIMULATED_SCALPING_SIGNAL} heading="Scalping entry" badge="65/100 · ENTER" />
              ) : (
                <DecisionSnapshot
                  decision={SIMULATED_PASSING_SIGNAL}
                  heading="Passing signal"
                  badge="80/100 · ENTER"
                />
              )}
            </ViewportReveal>
            <ViewportReveal variant="blur" delay={180} duration="slow">
              {isScalping ? (
                <DecisionSnapshot decision={SIMULATED_SCALPING_WAIT} heading="Near-miss" badge="45/100 · WAIT" />
              ) : (
                <DecisionSnapshot
                  decision={SIMULATED_NON_PASSING_SIGNAL}
                  heading="Non-passing signal"
                  badge="42/100 · WAIT"
                />
              )}
            </ViewportReveal>
          </div>
          <ViewportReveal className="mt-4" variant="up" delay={260} duration="slow">
            <LiveSnapshot decision={latestDecision} />
          </ViewportReveal>
        </div>
      ) : null}
      </div>
    </section>
  );
}
