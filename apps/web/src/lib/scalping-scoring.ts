import type { StatusPayload } from "@/lib/schemas";

export const SCALPING_FACTOR_KEYS = [
  "micro_momentum",
  "slippage_ok",
  "regime_neutro",
  "no_whale_dump",
  "gas_viable",
] as const;

export const SCALPING_FACTOR_WEIGHTS: Record<(typeof SCALPING_FACTOR_KEYS)[number], number> = {
  micro_momentum: 30,
  slippage_ok: 25,
  regime_neutro: 20,
  no_whale_dump: 15,
  gas_viable: 10,
};

export const SCALPING_ENTRY_SCORE_MIN = 60;
export const SCALPING_ENTRY_SCORE_MAX = 100;

export type ScalpingFactorKey = (typeof SCALPING_FACTOR_KEYS)[number];

export function scalpingFactorStats(decision: StatusPayload["decisions"][number]) {
  const score =
    typeof decision.entry_score === "number"
      ? decision.entry_score
      : SCALPING_FACTOR_KEYS.reduce(
          (total, key) => total + (decision.factor_scores?.[key] ? SCALPING_FACTOR_WEIGHTS[key] : 0),
          0,
        );

  return {
    score,
    max: SCALPING_ENTRY_SCORE_MAX,
    required: SCALPING_ENTRY_SCORE_MIN,
    met: score >= SCALPING_ENTRY_SCORE_MIN,
  };
}

export function scalpingFactorSummary(decision: StatusPayload["decisions"][number]) {
  const stats = scalpingFactorStats(decision);
  return `score ${stats.score}/${stats.max}`;
}
