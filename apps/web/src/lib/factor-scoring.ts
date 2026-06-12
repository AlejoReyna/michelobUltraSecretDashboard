import type { StatusPayload } from "@/lib/schemas";
import { SCALPING_FACTOR_KEYS } from "@/lib/scalping-scoring";

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

export type StrategyMode = "breakout" | "scalping";

export function resolveStrategyMode(decision: StatusPayload["decisions"][number]): StrategyMode {
  if (decision.strategy_mode === "scalping" || decision.strategy_mode === "breakout") {
    return decision.strategy_mode;
  }

  const factorKeys = Object.keys(decision.factor_scores ?? {});
  if (factorKeys.some((key) => SCALPING_FACTOR_KEYS.includes(key as (typeof SCALPING_FACTOR_KEYS)[number]))) {
    return "scalping";
  }

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
    required: CORE_ENTRY_FACTOR_COUNT,
    met: corePassed >= CORE_ENTRY_FACTOR_COUNT,
  };
}

export function decisionFactorSummary(decision: StatusPayload["decisions"][number]) {
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
