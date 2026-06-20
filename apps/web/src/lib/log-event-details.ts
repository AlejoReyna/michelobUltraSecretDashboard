import type { StatusPayload } from "@/lib/schemas";
import {
  ENTRY_FACTOR_KEYS,
  breakoutEntryScoreStats,
  entryFactorStats,
  isComplianceDecision,
  resolveStrategyMode,
} from "@/lib/factor-scoring";

export type ActivityDetail = {
  label: string;
  value: string;
  tone?: "green" | "yellow" | "red" | "neutral";
};

export type FactorScoreDetail = {
  key: string;
  label: string;
  passed: boolean;
};

/**
 * One line of evidence that a paid x402 micropayment fed the algorithm: which
 * CMC x402 tool was called, what data it provided, the entry factor it drives,
 * the live reading behind that factor, and whether the factor passed.
 */
export type X402EvidenceRow = {
  tool: string;
  provides: string;
  factor: string;
  reading: string;
  passed: boolean | null;
};

export type LogEventDetails = {
  items: ActivityDetail[];
  factors?: FactorScoreDetail[];
  x402Evidence?: X402EvidenceRow[];
};

const FACTOR_LABELS: Record<string, string> = {
  volume_breakout: "Volume breakout",
  six_hour_high_break: "6h high break",
  regime_not_risk_off: "Regime not risk-off",
  slippage_under_cap: "Slippage under cap",
  rsi_in_range: "RSI in range",
  derivatives_risk_clear: "Derivatives risk clear",
};

/**
 * Short, human-readable explanation for why each signal factor passed or failed.
 * Shown inline under each factor row in the live decision scan so it's obvious
 * what the agent actually checked and what blocked the trade.
 */
const FACTOR_EXPLANATIONS: Record<string, { pass: string; fail: string }> = {
  volume_breakout: {
    pass: "Volume surged above the breakout threshold.",
    fail: "Volume hasn't surged enough to confirm a breakout.",
  },
  six_hour_high_break: {
    pass: "Price cleared its 6-hour reference high.",
    fail: "Price hasn't cleared its 6-hour reference high.",
  },
  regime_not_risk_off: {
    pass: "Market regime is risk-on / neutral.",
    fail: "Market regime is risk-off — broad conditions unfavourable.",
  },
  slippage_under_cap: {
    pass: "Estimated slippage is within the cap.",
    fail: "Slippage is missing or above the cap.",
  },
  rsi_in_range: {
    pass: "RSI sits inside the entry band.",
    fail: "RSI is outside the entry band (overbought / oversold).",
  },
  derivatives_risk_clear: {
    pass: "Derivatives risk signals are clear.",
    fail: "Derivatives risk elevated (funding / OI / liquidations).",
  },
  micro_momentum: {
    pass: "Short-term momentum is positive.",
    fail: "Short-term momentum is too weak to scalp.",
  },
  slippage_ok: {
    pass: "Slippage is acceptable for a scalp.",
    fail: "Slippage is too high for a scalp.",
  },
  regime_neutro: {
    pass: "Regime is neutral / favourable.",
    fail: "Regime is not neutral for scalping.",
  },
  no_whale_dump: {
    pass: "No large sell pressure detected.",
    fail: "Large sell pressure / whale dump detected.",
  },
  gas_viable: {
    pass: "Gas cost is viable for the trade.",
    fail: "Gas cost is too high to be viable.",
  },
};

export function explainFactor(key: string, passed: boolean): string {
  const entry = FACTOR_EXPLANATIONS[key];
  if (entry) {
    return passed ? entry.pass : entry.fail;
  }
  const readable = key.replaceAll("_", " ");
  return passed ? `${readable}: condition met.` : `${readable}: condition not met.`;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

function formatUsd(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? usdFormatter.format(value) : "N/A";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${percentFormatter.format(value)}%` : "N/A";
}

function formatSlippagePct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${percentFormatter.format(value * 100)}%`
    : "N/A";
}

function formatTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return "N/A";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === true) {
    return "Yes";
  }

  if (value === false) {
    return "No";
  }

  return "N/A";
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function formatReasonCode(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  return value.replaceAll("_", " ").replaceAll(":", ": ");
}

function factorDetails(
  scores: StatusPayload["decisions"][number]["factor_scores"],
): FactorScoreDetail[] {
  return ENTRY_FACTOR_KEYS.map((key) => ({
    key,
    label: FACTOR_LABELS[key] ?? key.replaceAll("_", " "),
    passed: Boolean(scores?.[key]),
  }));
}

/**
 * Map each CMC x402 paid tool to the entry factor(s) it powers, so the activity
 * view can show concretely how a micropayment turns into an algorithm input.
 * Built from the decision's own factor_scores/factor_metrics so it reflects the
 * real numbers behind that cycle.
 */
const X402_TOOL_FACTORS: { tool: string; provides: string; factor: string; key: string }[] = [
  {
    tool: "get_crypto_technical_analysis",
    provides: "RSI-14 / MACD",
    factor: "RSI in range",
    key: "rsi_in_range",
  },
  {
    tool: "get_crypto_derivatives_metrics",
    provides: "funding rate / open interest",
    factor: "Derivatives risk clear",
    key: "derivatives_risk_clear",
  },
  {
    tool: "get_crypto_quotes_latest",
    provides: "price / 24h volume / highs",
    factor: "Volume breakout · 6h high",
    key: "volume_breakout",
  },
];

function x402Evidence(decision: StatusPayload["decisions"][number]): X402EvidenceRow[] {
  // Compliance swaps aren't scored off the x402 factor set.
  if (isComplianceDecision(decision)) {
    return [];
  }
  const scores = decision.factor_scores ?? {};
  const metrics = (decision.factor_metrics ?? {}) as Record<string, string>;
  const rows: X402EvidenceRow[] = [];
  for (const src of X402_TOOL_FACTORS) {
    if (!(src.key in scores)) {
      continue; // only show tools whose factor was actually evaluated this cycle
    }
    rows.push({
      tool: src.tool,
      provides: src.provides,
      factor: src.factor,
      reading: metrics[src.key] ?? "—",
      passed: typeof scores[src.key] === "boolean" ? Boolean(scores[src.key]) : null,
    });
  }
  return rows;
}

export function detailsFromDecision(decision: StatusPayload["decisions"][number]): LogEventDetails {
  const strategyMode = resolveStrategyMode(decision);
  const compliance = isComplianceDecision(decision);
  const breakoutFactors = entryFactorStats(decision);
  const breakoutScore = breakoutEntryScoreStats(decision);

  // A daily-minimum compliance swap is not scored against the entry factors;
  // show it as such instead of a misleading "1/6 factors".
  const scoreItem = compliance
    ? {
        label: "Entry score",
        value: "Compliance trade — not scored",
        tone: "neutral" as const,
      }
    : breakoutScore.score != null
        ? {
            label: "Entry score",
            value: `${breakoutScore.score}/${breakoutScore.max} (need ${breakoutScore.required}+; quote floor ${breakoutScore.quoteFloor})`,
            tone: (breakoutScore.met
              ? "green"
              : breakoutScore.score >= breakoutScore.quoteFloor
                ? "yellow"
                : "red") as "green" | "yellow" | "red",
          }
      : {
          label: "Factors passed",
          value: `${breakoutFactors.passed}/${breakoutFactors.total} factors`,
          tone: (breakoutFactors.passed >= breakoutFactors.required
            ? "green"
            : breakoutFactors.passed >= breakoutFactors.required - 1
              ? "yellow"
              : "red") as "green" | "yellow" | "red",
        };

  return {
    items: [
      { label: "Timestamp", value: formatTimestamp(decision.timestamp) },
      { label: "Strategy", value: strategyMode },
      { label: "Cycle", value: decision.cycle_number != null ? String(decision.cycle_number) : "N/A" },
      { label: "Mode", value: decision.mode ? String(decision.mode).toUpperCase() : "N/A" },
      { label: "Portfolio", value: formatUsd(decision.portfolio_value_usdc) },
      { label: "Open positions", value: decision.position_count != null ? String(decision.position_count) : "N/A" },
      {
        label: "Entries allowed",
        value: formatBoolean(decision.entries_allowed),
        tone:
          decision.entries_allowed === true ? "green" : decision.entries_allowed === false ? "red" : "neutral",
      },
      { label: "Position size", value: formatUsd(decision.position_size_usdc) },
      { label: "Slippage est.", value: formatSlippagePct(decision.estimated_slippage_pct) },
      scoreItem,
      compliance
        ? {
            label: "Source",
            value: "Daily-minimum compliance swap",
            tone: "neutral" as const,
          }
        : null,
      !compliance && strategyMode === "breakout"
        ? {
            label: "Slippage gate",
            value: breakoutScore.slippageMet ? "Under cap" : "Missing or above cap",
            tone: (breakoutScore.slippageMet ? "green" : "red") as "green" | "red",
          }
        : null,
      decision.entries_allowed === false || decision.entries_blocked_reason
        ? {
            label: "Blocked reason",
            value: formatReasonCode(decision.entries_blocked_reason),
            tone: "red" as const,
          }
        : null,
      { label: "Exit reason", value: decision.exit_reason?.trim() || "—" },
      {
        label: "Hold time",
        value:
          typeof decision.hold_time_seconds === "number"
            ? `${Math.round(decision.hold_time_seconds / 60)} min`
            : "—",
      },
      {
        label: "Priced targets",
        value: decision.priced_target_count != null ? String(decision.priced_target_count) : "N/A",
      },
      { label: "Reason", value: decision.reason?.trim() || "—" },
    ].filter((item): item is ActivityDetail => item != null),
    factors: factorDetails(decision.factor_scores),
    x402Evidence: x402Evidence(decision),
  };
}

export function detailsFromExecution(execution: StatusPayload["executions"][number]): LogEventDetails {
  const txHash =
    execution.tx_hash ??
    stringFromUnknown(execution.result?.tx_hash) ??
    stringFromUnknown(execution.result?.hash);
  const approvalHash = execution.approval_hash ?? stringFromUnknown(execution.result?.approval_hash);
  const error = execution.error ?? stringFromUnknown(execution.result?.error);
  const provider = execution.provider ?? stringFromUnknown(execution.result?.provider);
  const input = execution.input ?? stringFromUnknown(execution.result?.input);
  const output = execution.output ?? stringFromUnknown(execution.result?.output);
  const minReceived = execution.minReceived ?? stringFromUnknown(execution.result?.minReceived);
  const priceImpact = execution.priceImpact ?? execution.result?.priceImpact;

  const items: ActivityDetail[] = [
    { label: "Timestamp", value: formatTimestamp(execution.timestamp) },
    { label: "Action", value: execution.action ?? "SWAP" },
    {
      label: "Pair",
      value: `${execution.from_symbol ?? "?"} → ${execution.to_symbol ?? "?"}`,
    },
    {
      label: "Amount in",
      value:
        typeof execution.amount_in === "number" && Number.isFinite(execution.amount_in)
          ? String(execution.amount_in)
          : "N/A",
    },
    {
      label: "Expected out",
      value:
        typeof execution.expected_amount_out === "number" && Number.isFinite(execution.expected_amount_out)
          ? String(execution.expected_amount_out)
          : "N/A",
    },
    { label: "Max slippage", value: formatPercent(execution.max_slippage_pct) },
    { label: "Provider", value: provider ?? "N/A" },
    { label: "Input", value: input ?? "N/A" },
    { label: "Output", value: output ?? "N/A" },
    { label: "Min received", value: minReceived ?? "N/A" },
    {
      label: "Price impact",
      value: priceImpact != null ? String(priceImpact) : "N/A",
    },
    { label: "Tx hash", value: txHash ?? "N/A" },
    { label: "Approval hash", value: approvalHash ?? "N/A" },
  ];

  if (error) {
    items.push({ label: "Error", value: error, tone: "red" });
  }

  return { items };
}

export function detailsFromMovement(movement: StatusPayload["wallet"]["movements"][number]): LogEventDetails {
  return {
    items: [
      { label: "Timestamp", value: formatTimestamp(movement.timestamp) },
      { label: "Chain", value: movement.chain ?? "N/A" },
      { label: "Action", value: movement.action ?? "N/A" },
      {
        label: "Pair",
        value: `${movement.fromSymbol ?? "?"} → ${movement.toSymbol ?? "?"}`,
      },
      {
        label: "Amount in",
        value:
          typeof movement.amountIn === "number" && Number.isFinite(movement.amountIn)
            ? String(movement.amountIn)
            : "N/A",
      },
      {
        label: "Output",
        value: movement.output ?? "N/A",
      },
      { label: "Status", value: movement.status ?? "N/A" },
      { label: "Tx hash", value: movement.txHash ?? "N/A" },
      ...(movement.error ? [{ label: "Error", value: movement.error, tone: "red" as const }] : []),
    ],
  };
}

export function detailsFromSellHistory(row: StatusPayload["sellHistory"][number]): LogEventDetails {
  return {
    items: [
      { label: "Timestamp", value: formatTimestamp(row.timestamp) },
      { label: "Symbol", value: row.symbol },
      { label: "Trade ID", value: row.trade_id ?? "N/A" },
      {
        label: "Amount sold",
        value: typeof row.amount_sold === "number" && Number.isFinite(row.amount_sold) ? String(row.amount_sold) : "N/A",
      },
      {
        label: "Balance before",
        value:
          typeof row.balance_before === "number" && Number.isFinite(row.balance_before)
            ? String(row.balance_before)
            : "N/A",
      },
      {
        label: "Balance after",
        value:
          typeof row.balance_after === "number" && Number.isFinite(row.balance_after)
            ? String(row.balance_after)
            : "N/A",
      },
      { label: "Exit reason", value: row.exit_reason?.trim() || "—" },
      {
        label: "Realized PnL",
        value: formatUsd(row.realized_pnl_usdc),
        tone: typeof row.realized_pnl_usdc === "number" && row.realized_pnl_usdc >= 0 ? "green" : "red",
      },
      {
        label: "Verified",
        value: row.verified ? "Yes" : "No",
        tone: row.verified ? "green" : "red",
      },
      { label: "Tx hash", value: row.exit_tx_hash ?? "N/A" },
    ],
  };
}
