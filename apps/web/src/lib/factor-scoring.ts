import type { StatusPayload } from "@/lib/schemas";

export const ENTRY_FACTOR_KEYS = [
  "volume_breakout",
  "six_hour_high_break",
  "regime_not_risk_off",
  "slippage_under_cap",
  "rsi_in_range",
  "derivatives_risk_clear",
] as const;

export const ENTRY_FACTOR_COUNT = ENTRY_FACTOR_KEYS.length;

export type EntryFactorKey = (typeof ENTRY_FACTOR_KEYS)[number];

export function countPassedFactors(
  scores: StatusPayload["decisions"][number]["factor_scores"],
  keys: readonly string[] = ENTRY_FACTOR_KEYS,
) {
  return keys.filter((key) => Boolean(scores?.[key])).length;
}

export function entryFactorStats(decision: StatusPayload["decisions"][number]) {
  const passed =
    typeof decision.true_factor_count === "number"
      ? decision.true_factor_count
      : countPassedFactors(decision.factor_scores);

  return {
    passed,
    total: ENTRY_FACTOR_COUNT,
    required: ENTRY_FACTOR_COUNT,
    met: passed >= ENTRY_FACTOR_COUNT,
  };
}

export function decisionFactorSummary(decision: StatusPayload["decisions"][number]) {
  const stats = entryFactorStats(decision);
  return `${stats.passed}/${stats.total} factors`;
}

export function parseRequiredFactorCount(reason: string | null | undefined): number | null {
  if (!reason) {
    return null;
  }

  const match = reason.match(/need (\d+)\)/);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}
