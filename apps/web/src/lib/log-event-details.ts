import type { StatusPayload } from "@/lib/schemas";
import {
  ENTRY_FACTOR_COUNT,
  ENTRY_FACTOR_KEYS,
  entryFactorStats,
  parseRequiredFactorCount,
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

export type LogEventDetails = {
  items: ActivityDetail[];
  factors?: FactorScoreDetail[];
};

const FACTOR_LABELS: Record<string, string> = {
  volume_breakout: "Volume breakout",
  six_hour_high_break: "6h high break",
  regime_not_risk_off: "Regime not risk-off",
  slippage_under_cap: "Slippage under cap",
  rsi_in_range: "RSI in range",
  derivatives_risk_clear: "Derivatives risk clear",
};

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

function factorDetails(scores: StatusPayload["decisions"][number]["factor_scores"]): FactorScoreDetail[] {
  return ENTRY_FACTOR_KEYS.filter((key) => key in (scores ?? {})).map((key) => ({
    key,
    label: FACTOR_LABELS[key] ?? key.replaceAll("_", " "),
    passed: Boolean(scores?.[key]),
  }));
}

export function detailsFromDecision(decision: StatusPayload["decisions"][number]): LogEventDetails {
  const factors = entryFactorStats(decision);
  const required = parseRequiredFactorCount(decision.reason) ?? factors.required;

  return {
    items: [
      { label: "Timestamp", value: formatTimestamp(decision.timestamp) },
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
      { label: "Slippage est.", value: formatPercent(decision.estimated_slippage_pct) },
      {
        label: "Factors passed",
        value: `${factors.passed}/${factors.total} (need ${required} to enter)`,
        tone: factors.passed >= required ? "green" : factors.passed >= required - 1 ? "yellow" : "red",
      },
      {
        label: "Priced targets",
        value: decision.priced_target_count != null ? String(decision.priced_target_count) : "N/A",
      },
      { label: "Reason", value: decision.reason?.trim() || "—" },
    ],
    factors: factorDetails(decision.factor_scores),
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
