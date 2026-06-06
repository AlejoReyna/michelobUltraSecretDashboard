import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redact, safeError } from "./redact.js";

const execFileAsync = promisify(execFile);

export const TWAK_COMMAND_KEYS = [
  "bscAddress",
  "baseAddress",
  "portfolio",
  "bscBalance",
  "baseBalance",
  "bscHistory",
  "baseHistory",
] as const;

export type TwakCommandKey = (typeof TWAK_COMMAND_KEYS)[number];

const ALLOWED_TWAK_COMMANDS: Record<TwakCommandKey, readonly string[]> = {
  bscAddress: ["wallet", "address", "--chain", "bsc", "--json"],
  baseAddress: ["wallet", "address", "--chain", "base", "--json"],
  portfolio: ["wallet", "portfolio", "--json"],
  bscBalance: ["wallet", "balance", "--chain", "bsc", "--json"],
  baseBalance: ["wallet", "balance", "--chain", "base", "--json"],
  bscHistory: ["history", "--chain", "bsc", "--limit", "20", "--json"],
  baseHistory: ["history", "--chain", "base", "--limit", "20", "--json"],
};

export type TwakCommandResult = {
  ok: boolean;
  data: unknown | null;
  error?: string;
};

export type TwakTelemetry = Record<TwakCommandKey, TwakCommandResult>;

export type TwakCacheState = "empty" | "warming" | "fresh" | "stale" | "refreshing";

export type TwakCacheInfo = {
  state: TwakCacheState;
  hasData: boolean;
  refreshedAt: string | null;
  ageMs: number | null;
  refreshIntervalMs: number;
  staleAt: string | null;
  refreshInFlight: boolean;
  refreshStartedAt: string | null;
  lastRefreshFinishedAt: string | null;
  lastRefreshDurationMs: number | null;
  lastRefreshReason: string | null;
  lastError: string | null;
};

export type TwakTelemetrySnapshot = {
  telemetry: TwakTelemetry;
  cache: TwakCacheInfo;
};

let cachedTwak: TwakTelemetry | null = null;
let cachedTwakAt = 0;
let refreshPromise: Promise<TwakTelemetry> | null = null;
let refreshStartedAt = 0;
let lastRefreshFinishedAt = 0;
let lastRefreshDurationMs: number | null = null;
let lastRefreshReason: string | null = null;
let lastRefreshError: string | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

const DEFAULT_TWAK_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TWAK_ERROR_RETRY_MS = 60 * 1000;
const DEFAULT_TWAK_COMMAND_TIMEOUT_MS = 8000;
const DEFAULT_TWAK_MAX_BUFFER_BYTES = 1024 * 1024;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const TWAK_CACHE_TTL_MS = positiveInteger(
  process.env.TWAK_REFRESH_INTERVAL_MS ?? process.env.TWAK_CACHE_TTL_MS,
  DEFAULT_TWAK_REFRESH_INTERVAL_MS,
);
const TWAK_ERROR_RETRY_MS = positiveInteger(process.env.TWAK_ERROR_RETRY_MS, DEFAULT_TWAK_ERROR_RETRY_MS);
const TWAK_COMMAND_TIMEOUT_MS = positiveInteger(process.env.TWAK_COMMAND_TIMEOUT_MS, DEFAULT_TWAK_COMMAND_TIMEOUT_MS);
const TWAK_MAX_BUFFER_BYTES = positiveInteger(process.env.TWAK_MAX_BUFFER_BYTES, DEFAULT_TWAK_MAX_BUFFER_BYTES);

function twakBin(): string {
  return process.env.TWAK_BIN?.trim() || "twak";
}

function twakExecOptions(): {
  timeout: number;
  maxBuffer: number;
  shell: false;
  env: NodeJS.ProcessEnv;
  cwd: string | undefined;
} {
  return {
    timeout: TWAK_COMMAND_TIMEOUT_MS,
    maxBuffer: TWAK_MAX_BUFFER_BYTES,
    shell: false,
    env: process.env,
    cwd: process.env.CASCADE_AI_PATH?.trim() || undefined,
  };
}

export function emptyTwakTelemetry(): TwakTelemetry {
  return Object.fromEntries(TWAK_COMMAND_KEYS.map((key) => [key, { ok: true, data: null }])) as TwakTelemetry;
}

export async function runTwakCommand(key: TwakCommandKey): Promise<TwakCommandResult> {
  const args = ALLOWED_TWAK_COMMANDS[key];

  try {
    const { stdout } = await execFileAsync(twakBin(), [...args], twakExecOptions());
    const trimmed = stdout.trim();
    const parsed = trimmed ? JSON.parse(trimmed) : null;

    return { ok: true, data: redact(parsed) };
  } catch (error) {
    const execError = error as Error & { stderr?: string | Buffer };
    const stderr = typeof execError.stderr === "string" ? execError.stderr.trim() : "";
    const detail = stderr || execError.message;
    return { ok: false, data: null, error: safeError(detail || error) };
  }
}

function isoTime(timestampMs: number): string | null {
  return timestampMs > 0 ? new Date(timestampMs).toISOString() : null;
}

function cacheState(now: number): TwakCacheState {
  if (!cachedTwak) {
    return refreshPromise ? "warming" : "empty";
  }

  if (refreshPromise) {
    return "refreshing";
  }

  return now - cachedTwakAt >= TWAK_CACHE_TTL_MS ? "stale" : "fresh";
}

export function getTwakTelemetrySnapshot(now = Date.now()): TwakTelemetrySnapshot {
  const ageMs = cachedTwak ? Math.max(0, now - cachedTwakAt) : null;

  return {
    telemetry: cachedTwak ?? emptyTwakTelemetry(),
    cache: {
      state: cacheState(now),
      hasData: Boolean(cachedTwak),
      refreshedAt: isoTime(cachedTwakAt),
      ageMs,
      refreshIntervalMs: TWAK_CACHE_TTL_MS,
      staleAt: cachedTwak ? isoTime(cachedTwakAt + TWAK_CACHE_TTL_MS) : null,
      refreshInFlight: Boolean(refreshPromise),
      refreshStartedAt: isoTime(refreshStartedAt),
      lastRefreshFinishedAt: isoTime(lastRefreshFinishedAt),
      lastRefreshDurationMs,
      lastRefreshReason,
      lastError: lastRefreshError,
    },
  };
}

async function loadTwakTelemetry(): Promise<TwakTelemetry> {
  // TWAK wallet commands share local state; run sequentially to avoid lock/race failures.
  const telemetry = {} as TwakTelemetry;
  for (const key of TWAK_COMMAND_KEYS) {
    telemetry[key] = await runTwakCommand(key);
  }

  return telemetry;
}

function failedCommands(telemetry: TwakTelemetry): TwakCommandKey[] {
  return TWAK_COMMAND_KEYS.filter((key) => !telemetry[key]?.ok);
}

function commandFailureSummary(telemetry: TwakTelemetry): string | null {
  const failed = failedCommands(telemetry);
  if (failed.length === 0) {
    return null;
  }

  const first = failed[0];
  const firstError = first ? telemetry[first]?.error : null;
  return `${failed.length}/${TWAK_COMMAND_KEYS.length} TWAK commands failed${firstError ? `; first: ${firstError}` : ""}`;
}

function shouldRefresh(now: number, force: boolean): boolean {
  if (force) {
    return true;
  }

  if (refreshPromise) {
    return false;
  }

  if (!cachedTwak) {
    return !lastRefreshFinishedAt || now - lastRefreshFinishedAt >= TWAK_ERROR_RETRY_MS;
  }

  return now - cachedTwakAt >= TWAK_CACHE_TTL_MS;
}

export function requestTwakRefresh(reason = "request", options: { force?: boolean } = {}): Promise<TwakTelemetry> | null {
  const now = Date.now();

  if (refreshPromise) {
    return refreshPromise;
  }

  if (!shouldRefresh(now, Boolean(options.force))) {
    return null;
  }

  refreshStartedAt = now;
  lastRefreshReason = reason;

  refreshPromise = loadTwakTelemetry()
    .then((telemetry) => {
      const finishedAt = Date.now();
      const failed = failedCommands(telemetry);
      const allFailed = failed.length === TWAK_COMMAND_KEYS.length;

      lastRefreshFinishedAt = finishedAt;
      lastRefreshDurationMs = finishedAt - now;
      lastRefreshError = commandFailureSummary(telemetry);

      if (allFailed) {
        return cachedTwak ?? emptyTwakTelemetry();
      }

      cachedTwak = telemetry;
      cachedTwakAt = finishedAt;
      return telemetry;
    })
    .catch((error) => {
      const finishedAt = Date.now();
      lastRefreshFinishedAt = finishedAt;
      lastRefreshDurationMs = finishedAt - now;
      lastRefreshError = safeError(error);
      console.warn(`TWAK background refresh failed: ${lastRefreshError}`);
      return cachedTwak ?? emptyTwakTelemetry();
    })
    .finally(() => {
      refreshPromise = null;
      refreshStartedAt = 0;
    });

  return refreshPromise;
}

export async function readTwakTelemetry(): Promise<TwakTelemetry> {
  const snapshot = getTwakTelemetrySnapshot();
  requestTwakRefresh("readTwakTelemetry");
  return snapshot.telemetry;
}

export function startTwakAutoRefresh(): () => void {
  if (refreshTimer) {
    return stopTwakAutoRefresh;
  }

  requestTwakRefresh("startup", { force: true });
  refreshTimer = setInterval(() => {
    requestTwakRefresh("interval");
  }, TWAK_CACHE_TTL_MS);
  refreshTimer.unref?.();

  return stopTwakAutoRefresh;
}

export function stopTwakAutoRefresh(): void {
  if (!refreshTimer) {
    return;
  }

  clearInterval(refreshTimer);
  refreshTimer = null;
}
