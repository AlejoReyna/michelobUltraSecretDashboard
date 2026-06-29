/**
 * In-memory per-IP sliding-window rate limiter.
 * No external dependencies. Resets on server cold start.
 */

interface RateEntry {
  count: number;
  resetAt: number;
}

const counters = new Map<string, RateEntry>();

export function checkRateLimit(
  ip: string,
  limit = 20,
  windowMs = 60_000,
): { allowed: boolean } {
  const now = Date.now();
  const entry = counters.get(ip);

  if (!entry || now > entry.resetAt) {
    counters.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  entry.count += 1;
  return { allowed: entry.count <= limit };
}
