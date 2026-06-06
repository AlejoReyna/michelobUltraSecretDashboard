import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FILES, readLastLogLine, sourceFile } from "./files.js";
import { redact, safeError } from "./redact.js";

const execFileAsync = promisify(execFile);

export type Health = {
  ok: boolean;
  agentRunning: boolean;
  pids: string[];
  lastLogLine: string | null;
  serverTime: string;
  sourcePath: string;
  error?: string;
};

export async function getHealth(sourcePath: string): Promise<Health> {
  const lastLogLine = await readLastLogLine(sourceFile(sourcePath, FILES.agentLog));

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
      serverTime: new Date().toISOString(),
      sourcePath,
    };
  } catch (error) {
    return {
      ok: true,
      agentRunning: false,
      pids: [],
      lastLogLine,
      serverTime: new Date().toISOString(),
      sourcePath,
      error: safeError(error),
    };
  }
}
