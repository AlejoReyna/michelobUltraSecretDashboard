import type { StatusPayload } from "@/lib/schemas";

export const DEFAULT_CYCLE_INTERVAL_MS = 5 * 60 * 1000;

export function inferCycleIntervalMs(decisions: StatusPayload["decisions"]): number {
  if (decisions.length < 2) {
    return DEFAULT_CYCLE_INTERVAL_MS;
  }

  const sorted = [...decisions]
    .filter((decision) => decision.timestamp)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const deltas: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const delta =
      new Date(sorted[index]!.timestamp).getTime() - new Date(sorted[index - 1]!.timestamp).getTime();

    if (delta > 0 && delta <= 30 * 60 * 1000) {
      deltas.push(delta);
    }
  }

  if (deltas.length === 0) {
    return DEFAULT_CYCLE_INTERVAL_MS;
  }

  deltas.sort((left, right) => left - right);
  const middle = Math.floor(deltas.length / 2);

  if (deltas.length % 2 === 1) {
    return deltas[middle]!;
  }

  return Math.round((deltas[middle - 1]! + deltas[middle]!) / 2);
}

export function nextCycleAt(
  lastDecisionTimestamp: string | null | undefined,
  intervalMs: number,
): number | null {
  if (!lastDecisionTimestamp) {
    return null;
  }

  const last = new Date(lastDecisionTimestamp).getTime();

  if (Number.isNaN(last)) {
    return null;
  }

  return last + intervalMs;
}

export function cycleCountdownMs(nextAt: number | null, nowMs: number): number | null {
  if (nextAt === null) {
    return null;
  }

  return Math.max(0, nextAt - nowMs);
}

export function formatCycleCountdown(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
