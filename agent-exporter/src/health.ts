import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { FILES, readLatestAgentLogLine, sourceFile } from "./files.js";
import { redact, safeError } from "./redact.js";

const execFileAsync = promisify(execFile);

export type Health = {
  ok: boolean;
  agentRunning: boolean;
  pids: string[];
  lastLogLine: string | null;
  lastLogSource: string | null;
  lastLogModifiedAt: string | null;
  lastLogStale: boolean;
  serverTime: string;
  sourcePath: string;
  error?: string;
};

async function agentLogIsStale(sourcePath: string, logModifiedAtMs: number | null): Promise<boolean> {
  if (logModifiedAtMs === null) {
    return false;
  }

  try {
    const stat = await fs.stat(sourceFile(sourcePath, FILES.decisionLog));
    return logModifiedAtMs < stat.mtimeMs;
  } catch {
    return false;
  }
}

export async function getHealth(sourcePath: string): Promise<Health> {
  const { line, source, modifiedAt, modifiedAtMs } = await readLatestAgentLogLine(sourcePath);
  const lastLogStale = await agentLogIsStale(sourcePath, modifiedAtMs);

  const lastLogLine = lastLogStale ? null : line;
  const lastLogSource = source;

  try {
    const { stdout } = await execFileAsync("pgrep", ["-af", "src.main"], {
      timeout: 3000,
      maxBuffer: 64 * 1024,
    });
    const pids = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => redact(line));

    return {
      ok: true,
      agentRunning: pids.length > 0,
      pids,
      lastLogLine,
      lastLogSource,
      lastLogModifiedAt: modifiedAt,
      lastLogStale,
      serverTime: new Date().toISOString(),
      sourcePath,
    };
  } catch (error) {
    return {
      ok: true,
      agentRunning: false,
      pids: [],
      lastLogLine,
      lastLogSource,
      lastLogModifiedAt: modifiedAt,
      lastLogStale,
      serverTime: new Date().toISOString(),
      sourcePath,
      error: safeError(error),
    };
  }
}
