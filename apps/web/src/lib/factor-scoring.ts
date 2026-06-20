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

/**
 * Legacy audit grouping. Breakout v3 enters on weighted entry_score plus the
 * slippage hard gate; these booleans remain useful for compatibility displays.
 */
export const CORE_ENTRY_FACTOR_KEYS = [
  "volume_breakout",
  "six_hour_high_break",
  "slippage_under_cap",
] as const;

export const CORE_ENTRY_FACTOR_COUNT = CORE_ENTRY_FACTOR_KEYS.length;
export const BREAKOUT_ENTRY_SCORE_MIN = 45;
export const BREAKOUT_ENTRY_SCORE_MAX = 100;
export const BREAKOUT_QUOTE_SCORE_FLOOR = 40;

export type EntryFactorKey = (typeof ENTRY_FACTOR_KEYS)[number];

export type StrategyMode = "breakout";

/**
 * A daily-minimum compliance swap is a tiny end-of-day trade fired purely to
 * satisfy the competition's one-trade-per-day rule. It is NOT evaluated against
 * the six entry factors — the engine tags it with `source="daily_minimum"` and
 * `factor_scores={ daily_minimum: true }`, which a naive factor counter renders
 * as a misleading "1/6 factors". Detect it so callers can show "compliance
 * trade" / "not scored" instead.
 */
export function isComplianceDecision(decision: StatusPayload["decisions"][number]): boolean {
  const source = (decision as { source?: unknown }).source;
  if (typeof source === "string" && source.trim().toLowerCase() === "daily_minimum") {
    return true;
  }
  return Boolean(decision.factor_scores?.daily_minimum);
}

export function resolveStrategyMode(_decision: StatusPayload["decisions"][number]): StrategyMode {
  return "breakout";
}

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
  const corePassed = countPassedFactors(decision.factor_scores, CORE_ENTRY_FACTOR_KEYS);

  return {
    passed,
    total: ENTRY_FACTOR_COUNT,
    corePassed,
    coreTotal: CORE_ENTRY_FACTOR_COUNT,
    required: ENTRY_FACTOR_COUNT,
    met: passed >= ENTRY_FACTOR_COUNT,
  };
}

export const COMPLIANCE_TRADE_LABEL = "compliance trade";

export function decisionFactorSummary(decision: StatusPayload["decisions"][number]) {
  if (isComplianceDecision(decision)) {
    return COMPLIANCE_TRADE_LABEL;
  }
  if (resolveStrategyMode(decision) === "breakout" && typeof decision.entry_score === "number") {
    return `score ${Math.round(decision.entry_score)}/${BREAKOUT_ENTRY_SCORE_MAX}`;
  }
  const stats = entryFactorStats(decision);
  return `${stats.passed}/${stats.total} factors`;
}

export function breakoutEntryScoreStats(decision: StatusPayload["decisions"][number]) {
  const score = typeof decision.entry_score === "number" && Number.isFinite(decision.entry_score)
    ? decision.entry_score
    : null;
  const slippageMet = Boolean(decision.factor_scores?.slippage_under_cap);
  const scoreMet = score != null ? score >= BREAKOUT_ENTRY_SCORE_MIN : false;

  return {
    score,
    max: BREAKOUT_ENTRY_SCORE_MAX,
    required: BREAKOUT_ENTRY_SCORE_MIN,
    quoteFloor: BREAKOUT_QUOTE_SCORE_FLOOR,
    scoreMet,
    slippageMet,
    met: scoreMet && slippageMet,
  };
}

export function parseRequiredFactorCount(reason: string | null | undefined): number | null {
  if (!reason) {
    return null;
  }

  const match = reason.match(/need (\d+)\)/);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}
