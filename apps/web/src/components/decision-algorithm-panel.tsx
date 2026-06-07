import {
  ViewportReveal,
  chapterRevealVariant,
  factorRevealVariant,
  outcomeRevealVariant,
} from "@/components/viewport-reveal";
import {
  ENTRY_FACTOR_COUNT,
  ENTRY_FACTOR_KEYS,
  entryFactorStats,
  type EntryFactorKey,
} from "@/lib/factor-scoring";
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
    title: "Volume breakout",
    plain: "More people are trading this token than usual.",
    detail:
      "Recent trading volume is significantly above its recent average. That suggests real interest—not just a tiny price wiggle on low liquidity.",
    dataSource: "CoinMarketCap price & volume history",
  },
  {
    key: "six_hour_high_break",
    title: "6-hour high break",
    plain: "Price just pushed above its recent ceiling.",
    detail:
      "The token trades above the highest price seen in the last 6 hours. The bot treats that as short-term upward momentum before committing capital.",
    dataSource: "6-hour OHLC candles",
  },
  {
    key: "regime_not_risk_off",
    title: "Market not in risk-off",
    plain: "The broader market is not in panic mode.",
    detail:
      "When Bitcoin and overall sentiment turn defensive, new buys are riskier. This check confirms the macro backdrop is neutral or risk-on—not a broad selloff.",
    dataSource: "BTC trend & market regime signal",
  },
  {
    key: "slippage_under_cap",
    title: "Slippage under cap",
    plain: "The swap would not cost too much in price impact.",
    detail:
      "Before buying, the bot estimates how much the price would move against you (slippage). If expected slippage exceeds the configured cap, the trade is too expensive to enter.",
    dataSource: "TWAK / LiquidMesh route quote",
  },
  {
    key: "rsi_in_range",
    title: "RSI in range",
    plain: "Momentum is healthy—not exhausted or crashing.",
    detail:
      "RSI (Relative Strength Index) measures how stretched a move is on a 0–100 scale. The bot wants a window that is strong enough to buy but not so overheated that a pullback is likely.",
    dataSource: "14-period RSI on recent candles",
  },
  {
    key: "derivatives_risk_clear",
    title: "Derivatives risk clear",
    plain: "Futures markets are not flashing danger signals.",
    detail:
      "Extreme funding rates or crowded leveraged positions can foreshadow sharp reversals. This factor checks that derivatives data does not show elevated systemic risk for the token.",
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
    title: "Score factors",
    body: "Each candidate gets six yes/no checks. Think of it as a checklist: one weak link and the bot waits.",
  },
  {
    step: "04",
    title: "Apply guardrails",
    body: "Even a perfect score can be blocked by daily loss limits, trade caps, or a risk-off regime override.",
  },
  {
    step: "05",
    title: "Decide & act",
    body: "Only when all six factors pass and guardrails allow it does the bot swap USDC for the token through TWAK.",
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
  factor_scores: {
    volume_breakout: true,
    six_hour_high_break: true,
    regime_not_risk_off: true,
    slippage_under_cap: true,
    rsi_in_range: true,
    derivatives_risk_clear: true,
  },
  true_factor_count: 6,
  estimated_slippage_pct: 0.18,
  reason: "6/6 factors passed",
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
  symbol: "BNB",
  position_size_usdc: 0,
  factor_scores: {
    volume_breakout: true,
    six_hour_high_break: false,
    regime_not_risk_off: true,
    slippage_under_cap: true,
    rsi_in_range: true,
    derivatives_risk_clear: true,
  },
  true_factor_count: 5,
  estimated_slippage_pct: 0.11,
  reason: "Waiting for six hour high confirmation.",
  priced_target_count: 149,
};

const CYCLE_INPUTS = [
  "Market data (CMC / x402)",
  "6-factor checklist",
  "Guardrails & limits",
  "TWAK swap execution",
  "Position tracking",
  "Decision log",
];

const OUTCOMES = [
  {
    action: "ENTER",
    summary: "Buy approved",
    body: "All 6/6 factors passed and guardrails allow new entries. The agent sizes the position, quotes slippage, and executes a USDC → token swap.",
  },
  {
    action: "WAIT",
    summary: "Keep watching",
    body: "One or more factors failed, or the bot wants stronger confirmation. No money moves— it logs the reason and tries again next cycle.",
  },
  {
    action: "BLOCKED",
    summary: "Guardrail stop",
    body: "Technical signals may look good, but a safety rule vetoed the trade—e.g. risk-off regime, daily loss budget, or entries disabled.",
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

function CycleOverviewList() {
  const itemVariants = ["right", "fade", "left", "up", "down", "scale"] as const;

  return (
    <ol className="space-y-2">
      {CYCLE_INPUTS.map((item, index) => (
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

function DecisionFlowList() {
  const steps = [
    { label: "New cycle", sub: "Read wallet & positions" },
    { label: "Scan allowlist", sub: "~149 BEP-20 tokens" },
    { label: "Score 6 factors", sub: "Per candidate token" },
    { label: "Guardrails OK?", sub: "Loss / regime / caps" },
    { label: "ENTER or WAIT", sub: "Swap or log & retry" },
  ];
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

function DecisionSnapshot({
  decision,
  heading = "Latest cycle snapshot",
  badge,
}: {
  decision: ExampleDecision;
  heading?: string;
  badge?: string;
}) {
  const stats = entryFactorStats(decision);
  const action = String(decision.action ?? "WAIT").toUpperCase();

  return (
    <div className="border border-[#2A2A2A] bg-black/88">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A] px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#757575]">{heading}</div>
            {badge ? (
              <span className="border border-[#2A2A2A] bg-[#0A0A0A] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A8A8A]">
                {badge}
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
            <span>Factor score</span>
            <span className="text-white">
              {stats.passed}/{stats.total} required
            </span>
          </div>
          <FactorScoreBar passed={stats.passed} total={stats.total} />
        </div>
        <div className="font-mono text-[11px] leading-5 text-[#A8A8A8]">
          <span className="text-[#757575]">Reason: </span>
          <span className="text-[#DADADA]">{decision.reason?.trim() || "—"}</span>
        </div>
      </div>
      <div className="grid gap-2 border-t border-[#1A1A1A] px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {ENTRY_FACTOR_KEYS.map((key) => {
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

export function DecisionAlgorithmPanel({
  latestDecision,
  compact = false,
}: {
  latestDecision: StatusPayload["latestDecision"];
  compact?: boolean;
}) {
  const chapterGap = compact ? "mt-8" : "mt-12";
  const panelClass = "border border-[#2A2A2A] bg-black/88 p-4";

  return (
    <section
      className={cx(
        "console-scroll flex min-h-0 flex-col overflow-y-auto",
        compact ? "flex-1 px-4 pt-4 pb-8" : "px-10 py-9",
      )}
    >
      <ViewportReveal variant="blur" duration="slow">
        <header className={cx("max-w-3xl", compact ? "shrink-0 border-b border-[#1A1A1A] pb-4" : "pb-2")}>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy explainer</div>
          <h1
            className={cx(
              "mt-2 font-mono font-semibold leading-tight text-white",
              compact ? "text-[28px]" : "text-[32px]",
            )}
          >
            How Buy Decisions Work
          </h1>
          <p className="mt-3 font-mono text-[12px] leading-5 text-[#8A8A8A]">
            The agent never guesses. On every cycle it gathers market data, runs six objective checks, applies safety
            guardrails, and only then swaps USDC for a token. Think of it as a disciplined checklist—not a hunch.
          </p>
        </header>
      </ViewportReveal>

      <div className={chapterGap}>
        <ViewportReveal variant={chapterRevealVariant(0)} delay={40} duration="slow">
          <ChapterDivider
            number="01"
            title="Overview"
            subtitle="Six inputs feed one decision. All must agree before money moves."
            chapterIndex={0}
          />
        </ViewportReveal>
        <div className={cx("mt-5 grid gap-4", !compact && "xl:grid-cols-2")}>
          <ViewportReveal variant="right" delay={80}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">Big picture</h3>
              <CycleOverviewList />
            </div>
          </ViewportReveal>
          <ViewportReveal variant="left" delay={140}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">
                The rule in one line
              </h3>
              <div className="border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-4">
                <p className="font-mono text-[18px] font-semibold leading-snug text-white">
                  All {ENTRY_FACTOR_COUNT}/{ENTRY_FACTOR_COUNT} factors must pass
                </p>
                <p className="mt-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">
                  Partial scores (e.g. 5/6) always result in WAIT—never a partial buy. Safety guardrails can still block
                  even a perfect score.
                </p>
              </div>
              <div className="mt-4 space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#757575]">
                  Example score bars
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                      <span>5/6 — WAIT</span>
                      <span>Missing one signal</span>
                    </div>
                    <FactorScoreBar passed={5} total={6} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                      <span>6/6 — eligible for ENTER</span>
                      <span>Full checklist</span>
                    </div>
                    <FactorScoreBar passed={6} total={6} />
                  </div>
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
            subtitle="From wake-up to swap—or to a logged wait state."
            chapterIndex={1}
          />
        </ViewportReveal>
        <ViewportReveal className="mt-5" variant="fade" delay={100} duration="slow">
          <div className={panelClass}>
            <div className={cx(!compact && "grid gap-6 lg:grid-cols-[minmax(0,220px)_1fr]")}>
              <DecisionFlowList />
              {!compact ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:mt-0 lg:grid-cols-1">
                  {CYCLE_STEPS.map((step, index) => (
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
            title="The six factors"
            subtitle="Each factor is a yes/no gate. Expand decision rows in Activity to see these same flags."
            chapterIndex={2}
          />
        </ViewportReveal>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ENTRY_FACTORS.map((factor, index) => (
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
            subtitle="Guardrails can veto a perfect score. A buy starts position management."
            chapterIndex={3}
          />
        </ViewportReveal>
        <div className={cx("mt-5 grid gap-4", !compact && "lg:grid-cols-2")}>
          <ViewportReveal variant="right" delay={90}>
            <div className={panelClass}>
              <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[#757575]">
                Safety guardrails
              </h3>
              <ul className="space-y-2">
                {[
                  {
                    title: "Risk-off regime",
                    body: "Macro conditions turn defensive. New buys pause until the regime clears—even if a single token looks strong.",
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
                ].map((item, index) => (
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
                What happens after ENTER
              </h3>
              <ol className="space-y-2 font-mono text-[11px] leading-5 text-[#8A8A8A]">
                {[
                  {
                    step: "01",
                    title: "Size the trade",
                    body: "Position size in USDC is computed from portfolio value and risk rules (`position_size_usdc`).",
                  },
                  {
                    step: "02",
                    title: "Quote & swap",
                    body: "TWAK routes through LiquidMesh on BSC with a max slippage cap (`max_slippage_pct`).",
                  },
                  {
                    step: "03",
                    title: "Track the position",
                    body: "Entry price, trailing stop, and take-profit levels are written to `positions.json` and shown on the Active Positions tab.",
                  },
                ].map((item, index) => (
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
            subtitle="Four actions the agent can emit each cycle."
            chapterIndex={4}
          />
        </ViewportReveal>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {OUTCOMES.map((outcome, index) => (
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

      {!compact ? (
        <div className={chapterGap}>
          <ViewportReveal variant={chapterRevealVariant(5)} delay={40} duration="slow">
            <ChapterDivider
              number="06"
              title="Examples"
              subtitle="Simulated and live cycle snapshots before guardrails apply."
              chapterIndex={5}
            />
          </ViewportReveal>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <ViewportReveal variant="scale" delay={100}>
              <DecisionSnapshot
                decision={SIMULATED_PASSING_SIGNAL}
                heading="Passing signal"
                badge="6/6 · ENTER"
              />
            </ViewportReveal>
            <ViewportReveal variant="blur" delay={180} duration="slow">
              <DecisionSnapshot
                decision={SIMULATED_NON_PASSING_SIGNAL}
                heading="Non-passing signal"
                badge="5/6 · WAIT"
              />
            </ViewportReveal>
          </div>
          <ViewportReveal className="mt-4" variant="up" delay={260} duration="slow">
            <LiveSnapshot decision={latestDecision} />
          </ViewportReveal>
        </div>
      ) : null}
    </section>
  );
}
