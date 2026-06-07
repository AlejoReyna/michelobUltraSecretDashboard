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

const OUTCOMES = [
  {
    action: "ENTER",
    color: "text-[#00FF00]",
    border: "border-[#00FF00]/40",
    bg: "bg-[#00FF00]/8",
    summary: "Buy approved",
    body: "All 6/6 factors passed and guardrails allow new entries. The agent sizes the position, quotes slippage, and executes a USDC → token swap.",
  },
  {
    action: "WAIT",
    color: "text-[#FACC15]",
    border: "border-[#FACC15]/40",
    bg: "bg-[#FACC15]/8",
    summary: "Keep watching",
    body: "One or more factors failed, or the bot wants stronger confirmation. No money moves— it logs the reason and tries again next cycle.",
  },
  {
    action: "BLOCKED",
    color: "text-[#FF8C42]",
    border: "border-[#FF8C42]/40",
    bg: "bg-[#FF8C42]/8",
    summary: "Guardrail stop",
    body: "Technical signals may look good, but a safety rule vetoed the trade—e.g. risk-off regime, daily loss budget, or entries disabled.",
  },
  {
    action: "HALT",
    color: "text-[#FF3737]",
    border: "border-[#FF3737]/40",
    bg: "bg-[#FF3737]/8",
    summary: "Full stop",
    body: "Critical failure or manual halt. The agent stops opening new positions until the condition clears.",
  },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function MindMapDiagram() {
  const branches = [
    { label: "Market data\n(CMC / x402)", angle: -90, color: "#2F8CFF" },
    { label: "6-factor\nchecklist", angle: -30, color: "#00FF00" },
    { label: "Guardrails\n& limits", angle: 30, color: "#FACC15" },
    { label: "TWAK swap\nexecution", angle: 90, color: "#FF8C42" },
    { label: "Position\ntracking", angle: 150, color: "#A78BFA" },
    { label: "Decision\nlog", angle: 210, color: "#8A8A8A" },
  ];

  const cx = 220;
  const cy = 200;
  const radius = 118;

  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 440 400" className="mx-auto w-full max-w-[440px]" aria-label="Decision algorithm mind map">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {branches.map((branch) => {
          const rad = (branch.angle * Math.PI) / 180;
          const x2 = cx + Math.cos(rad) * radius;
          const y2 = cy + Math.sin(rad) * radius;
          const labelX = cx + Math.cos(rad) * (radius + 52);
          const labelY = cy + Math.sin(rad) * (radius + 52);

          return (
            <g key={branch.label}>
              <line
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke={branch.color}
                strokeWidth="1.5"
                strokeOpacity="0.55"
                strokeDasharray="4 3"
              />
              <circle cx={x2} cy={y2} r="5" fill={branch.color} fillOpacity="0.85" />
              {branch.label.split("\n").map((line, i) => (
                <text
                  key={line}
                  x={labelX}
                  y={labelY + i * 14 - (branch.label.split("\n").length - 1) * 7}
                  textAnchor="middle"
                  fill="#CFCFCF"
                  fontSize="11"
                  fontFamily="Geist Mono, monospace"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}

        <circle cx={cx} cy={cy} r="54" fill="#0A0A0A" stroke="#00FF00" strokeWidth="1.5" filter="url(#glow)" />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#00FF00" fontSize="11" fontFamily="Geist Mono, monospace">
          Every
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="white" fontSize="13" fontWeight="600" fontFamily="Geist Mono, monospace">
          Trading Cycle
        </text>
      </svg>
    </div>
  );
}

function DecisionFlowChart() {
  const nodes = [
    { id: "start", label: "New cycle", sub: "Read wallet & positions", x: 0 },
    { id: "scan", label: "Scan allowlist", sub: "~149 BEP-20 tokens", x: 1 },
    { id: "score", label: "Score 6 factors", sub: "Per candidate token", x: 2 },
    { id: "guard", label: "Guardrails OK?", sub: "Loss / regime / caps", x: 3 },
    { id: "enter", label: "ENTER", sub: "6/6 + allowed", x: 4, highlight: "green" as const },
    { id: "wait", label: "WAIT / BLOCKED", sub: "Log & retry later", x: 4, y: 1, highlight: "yellow" as const },
  ];

  const boxW = 128;
  const boxH = 52;
  const gapX = 24;
  const startX = 8;
  const startY = 20;

  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 720 130" className="min-w-[640px] w-full" aria-label="Buy decision flow chart">
        {nodes
          .filter((n) => n.x < 4)
          .map((node, i, arr) => {
            if (i === arr.length - 1) return null;
            const x1 = startX + node.x * (boxW + gapX) + boxW;
            const y1 = startY + boxH / 2;
            const x2 = startX + arr[i + 1]!.x * (boxW + gapX);
            const y2 = startY + boxH / 2;
            return (
              <g key={`arrow-${node.id}`}>
                <line x1={x1} y1={y1} x2={x2 - 6} y2={y2} stroke="#333" strokeWidth="1.5" />
                <polygon points={`${x2 - 6},${y2 - 4} ${x2},${y2} ${x2 - 6},${y2 + 4}`} fill="#555" />
              </g>
            );
          })}

        {/* fork from guard to enter / wait */}
        <line
          x1={startX + 3 * (boxW + gapX) + boxW / 2}
          y1={startY + boxH}
          x2={startX + 3 * (boxW + gapX) + boxW / 2}
          y2={startY + boxH + 16}
          stroke="#333"
          strokeWidth="1.5"
        />
        <line
          x1={startX + 3 * (boxW + gapX) + boxW / 2}
          y1={startY + boxH + 16}
          x2={startX + 4 * (boxW + gapX) + boxW / 2}
          y2={startY + boxH + 16}
          stroke="#333"
          strokeWidth="1.5"
        />
        <line
          x1={startX + 4 * (boxW + gapX) + boxW / 2}
          y1={startY + boxH + 16}
          x2={startX + 4 * (boxW + gapX) + boxW / 2}
          y2={startY + boxH + 22}
          stroke="#333"
          strokeWidth="1.5"
        />
        <line
          x1={startX + 4 * (boxW + gapX) + boxW / 2}
          y1={startY + boxH + 16}
          x2={startX + 4 * (boxW + gapX) + boxW / 2}
          y2={startY + 78}
          stroke="#333"
          strokeWidth="1.5"
        />

        {nodes.map((node) => {
          const x = startX + node.x * (boxW + gapX);
          const y = startY + (node.y ?? 0) * 58;
          const stroke =
            node.highlight === "green" ? "#00FF00" : node.highlight === "yellow" ? "#FACC15" : "#2A2A2A";
          const fill =
            node.highlight === "green"
              ? "rgba(0,255,0,0.06)"
              : node.highlight === "yellow"
                ? "rgba(250,204,21,0.06)"
                : "#0A0A0A";

          return (
            <g key={node.id}>
              <rect x={x} y={y} width={boxW} height={boxH} fill={fill} stroke={stroke} strokeWidth="1" rx="0" />
              <text x={x + boxW / 2} y={y + 22} textAnchor="middle" fill="white" fontSize="11" fontWeight="600" fontFamily="Geist Mono, monospace">
                {node.label}
              </text>
              <text x={x + boxW / 2} y={y + 38} textAnchor="middle" fill="#8A8A8A" fontSize="9" fontFamily="Geist Mono, monospace">
                {node.sub}
              </text>
            </g>
          );
        })}

        <text x={startX + 3 * (boxW + gapX) + boxW + 12} y={startY + boxH / 2 + 4} fill="#00FF00" fontSize="10" fontFamily="Geist Mono, monospace">
          yes
        </text>
        <text x={startX + 3 * (boxW + gapX) + boxW + 12} y={startY + 78 + 4} fill="#FACC15" fontSize="10" fontFamily="Geist Mono, monospace">
          no
        </text>
      </svg>
    </div>
  );
}

function FactorScoreBar({ passed, total }: { passed: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cx("h-2 flex-1 border", i < passed ? "border-[#00FF00] bg-[#00FF00]/70" : "border-[#2A2A2A] bg-[#111]")}
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
  const actionTone =
    action === "ENTER"
      ? "text-[#00FF00]"
      : action === "BLOCKED"
        ? "text-[#FF8C42]"
        : action === "HALT"
          ? "text-[#FF3737]"
          : "text-[#FACC15]";

  return (
    <div className="border border-[#2A2A2A] bg-[#0A0A0A]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1A1A] px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#757575]">{heading}</div>
            {badge ? (
              <span className="border border-[#333] bg-[#111] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A8A8A]">
                {badge}
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-sm text-white">
            {decision.symbol ?? "—"} · cycle #{decision.cycle_number ?? "?"}
          </div>
        </div>
        <span className={cx("font-mono text-lg font-semibold", actionTone)}>{action}</span>
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
                passed ? "border-[#00FF00]/30 bg-[#00FF00]/5 text-[#DADADA]" : "border-[#2A2A2A] text-[#666]",
              )}
            >
              <span className={passed ? "text-[#00FF00]" : "text-[#444]"}>{passed ? "✓" : "○"}</span>
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
    <article className="flex flex-col border border-[#2A2A2A] bg-[#0A0A0A]">
      <div className="flex items-start gap-3 border-b border-[#1A1A1A] px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center border border-[#333] bg-[#111] font-mono text-[11px] text-[#00FF00]">
          {index + 1}
        </span>
        <div>
          <h3 className="font-mono text-sm font-semibold text-white">{factor.title}</h3>
          <p className="mt-1 font-mono text-[12px] leading-5 text-[#00FF00]/90">{factor.plain}</p>
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
  return (
    <section className={cx("console-scroll flex min-h-0 flex-col overflow-y-auto", compact ? "mx-4 mt-9" : "px-10 py-9")}>
      <header className="mb-8 max-w-3xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#757575]">Strategy explainer</div>
        <h1 className="mt-2 font-mono text-[32px] font-semibold leading-tight text-white">How Buy Decisions Work</h1>
        <p className="mt-3 font-mono text-[13px] leading-6 text-[#A8A8A8]">
          The agent never guesses. On every cycle it gathers market data, runs six objective checks, applies safety
          guardrails, and only then swaps USDC for a token. Think of it as a disciplined checklist—not a hunch.
        </p>
      </header>

      <div className="mb-10 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="border border-[#2A2A2A] bg-black/80 p-5">
          <h2 className="mb-1 font-mono text-sm font-semibold text-white">Big picture</h2>
          <p className="mb-4 font-mono text-[11px] leading-5 text-[#8A8A8A]">
            Six inputs feed one decision. All must agree before money moves.
          </p>
          <MindMapDiagram />
        </div>

        <div className="border border-[#2A2A2A] bg-black/80 p-5">
          <h2 className="mb-1 font-mono text-sm font-semibold text-white">The rule in one line</h2>
          <div className="mt-4 border border-[#00FF00]/30 bg-[#00FF00]/5 px-4 py-5">
            <p className="font-mono text-[22px] font-semibold leading-snug text-white">
              All <span className="text-[#00FF00]">{ENTRY_FACTOR_COUNT}/{ENTRY_FACTOR_COUNT}</span> factors must pass
            </p>
            <p className="mt-2 font-mono text-[12px] leading-5 text-[#A8A8A8]">
              Partial scores (e.g. 5/6) always result in WAIT—never a partial buy. Safety guardrails can still block
              even a perfect score.
            </p>
          </div>
          <div className="mt-4 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#757575]">Example score bars</div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                  <span>5/6 — WAIT</span>
                  <span className="text-[#FACC15]">Missing one signal</span>
                </div>
                <FactorScoreBar passed={5} total={6} />
              </div>
              <div>
                <div className="mb-1 flex justify-between font-mono text-[10px] text-[#8A8A8A]">
                  <span>6/6 — eligible for ENTER</span>
                  <span className="text-[#00FF00]">Full checklist</span>
                </div>
                <FactorScoreBar passed={6} total={6} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-10 border border-[#2A2A2A] bg-black/80 p-5">
        <h2 className="mb-1 font-mono text-sm font-semibold text-white">Cycle flow</h2>
        <p className="mb-4 font-mono text-[11px] leading-5 text-[#8A8A8A]">
          From wake-up to swap—or to a logged wait state.
        </p>
        <DecisionFlowChart />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CYCLE_STEPS.map((step) => (
            <div key={step.step} className="border border-[#1A1A1A] bg-[#0A0A0A] px-3 py-3">
              <div className="font-mono text-[10px] text-[#00FF00]">{step.step}</div>
              <div className="mt-1 font-mono text-[12px] font-semibold text-white">{step.title}</div>
              <p className="mt-1 font-mono text-[10px] leading-4 text-[#8A8A8A]">{step.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-10">
        <h2 className="mb-1 font-mono text-sm font-semibold text-white">The six factors (explained simply)</h2>
        <p className="mb-5 font-mono text-[11px] leading-5 text-[#8A8A8A]">
          Each factor is a yes/no gate. Hover the dashboard logs to see these same flags on every decision row.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ENTRY_FACTORS.map((factor, index) => (
            <FactorCard key={factor.key} factor={factor} index={index} />
          ))}
        </div>
      </div>

      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <div className="border border-[#2A2A2A] bg-black/80 p-5">
          <h2 className="mb-1 font-mono text-sm font-semibold text-white">Safety guardrails</h2>
          <p className="mb-4 font-mono text-[11px] leading-5 text-[#8A8A8A]">
            Even when all six factors pass, these limits can set{" "}
            <span className="text-[#FF8C42]">entries_allowed = false</span> and force BLOCKED.
          </p>
          <ul className="space-y-3">
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
            ].map((item) => (
              <li key={item.title} className="border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3">
                <div className="font-mono text-[12px] font-semibold text-[#FACC15]">{item.title}</div>
                <p className="mt-1 font-mono text-[11px] leading-5 text-[#A8A8A8]">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="border border-[#2A2A2A] bg-black/80 p-5">
          <h2 className="mb-1 font-mono text-sm font-semibold text-white">What happens after ENTER</h2>
          <p className="mb-4 font-mono text-[11px] leading-5 text-[#8A8A8A]">
            A buy is not the end—it starts position management.
          </p>
          <ol className="space-y-3 font-mono text-[11px] leading-5 text-[#A8A8A8]">
            <li className="flex gap-3 border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3">
              <span className="text-[#00FF00]">1</span>
              <span>
                <strong className="text-white">Size the trade</strong> — position size in USDC is computed from portfolio
                value and risk rules (`position_size_usdc`).
              </span>
            </li>
            <li className="flex gap-3 border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3">
              <span className="text-[#00FF00]">2</span>
              <span>
                <strong className="text-white">Quote & swap</strong> — TWAK routes through LiquidMesh on BSC with a max
                slippage cap (`max_slippage_pct`).
              </span>
            </li>
            <li className="flex gap-3 border border-[#1A1A1A] bg-[#0A0A0A] px-4 py-3">
              <span className="text-[#00FF00]">3</span>
              <span>
                <strong className="text-white">Track the position</strong> — entry price, trailing stop, and take-profit
                levels are written to `positions.json` and shown on the Active Positions tab.
              </span>
            </li>
          </ol>
        </div>
      </div>

      <div className="mb-10">
        <h2 className="mb-4 font-mono text-sm font-semibold text-white">Possible outcomes each cycle</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {OUTCOMES.map((outcome) => (
            <div key={outcome.action} className={cx("border px-4 py-4", outcome.border, outcome.bg)}>
              <div className={cx("font-mono text-lg font-bold", outcome.color)}>{outcome.action}</div>
              <div className="mt-1 font-mono text-[12px] font-semibold text-white">{outcome.summary}</div>
              <p className="mt-2 font-mono text-[11px] leading-5 text-[#A8A8A8]">{outcome.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-10">
        <h2 className="mb-1 font-mono text-sm font-semibold text-white">Simulated signal examples</h2>
        <p className="mb-4 font-mono text-[11px] leading-5 text-[#8A8A8A]">
          Realistic cycle snapshots showing what a passing vs non-passing checklist looks like before guardrails
          apply.
        </p>
        <div className="grid gap-6 xl:grid-cols-2">
          <DecisionSnapshot
            decision={SIMULATED_PASSING_SIGNAL}
            heading="Passing signal"
            badge="6/6 · ENTER"
          />
          <DecisionSnapshot
            decision={SIMULATED_NON_PASSING_SIGNAL}
            heading="Non-passing signal"
            badge="5/6 · WAIT"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-4 font-mono text-sm font-semibold text-white">Live example from telemetry</h2>
        <LiveSnapshot decision={latestDecision} />
      </div>
    </section>
  );
}
