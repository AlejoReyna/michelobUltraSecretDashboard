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

let cachedTwak: TwakTelemetry | null = null;
let cachedTwakAt = 0;
const TWAK_CACHE_TTL_MS = 30000;

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
    timeout: 8000,
    maxBuffer: 1024 * 1024,
    shell: false,
    env: process.env,
    cwd: process.env.CASCADE_AI_PATH?.trim() || undefined,
  };
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

export async function readTwakTelemetry(): Promise<TwakTelemetry> {
  const now = Date.now();

  if (cachedTwak && now - cachedTwakAt < TWAK_CACHE_TTL_MS) {
    return cachedTwak;
  }

  // TWAK wallet commands share local state; run sequentially to avoid lock/race failures.
  const telemetry = {} as TwakTelemetry;
  for (const key of TWAK_COMMAND_KEYS) {
    telemetry[key] = await runTwakCommand(key);
  }

  cachedTwak = telemetry;
  cachedTwakAt = now;
  return telemetry;
}
