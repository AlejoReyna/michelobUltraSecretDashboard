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

export async function runTwakCommand(key: TwakCommandKey): Promise<TwakCommandResult> {
  const args = ALLOWED_TWAK_COMMANDS[key];

  try {
    const { stdout } = await execFileAsync("twak", [...args], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    const trimmed = stdout.trim();
    const parsed = trimmed ? JSON.parse(trimmed) : null;

    return { ok: true, data: redact(parsed) };
  } catch (error) {
    return { ok: false, data: null, error: safeError(error) };
  }
}

export async function readTwakTelemetry(): Promise<TwakTelemetry> {
  const entries = await Promise.all(
    TWAK_COMMAND_KEYS.map(async (key) => [key, await runTwakCommand(key)] as const),
  );

  return Object.fromEntries(entries) as TwakTelemetry;
}
