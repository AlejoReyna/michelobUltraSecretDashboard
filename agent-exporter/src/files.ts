import { promises as fs } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { redact, safeError } from "./redact.js";

export type FileStatus = {
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  error?: string;
};

/** Live bot stdout is often redirected to bot_live.log; agent.log may be stale. */
export const AGENT_LOG_CANDIDATES = ["bot_live.log", "agent.log"] as const;

export const FILES = {
  agentLog: "agent.log",
  botLiveLog: "bot_live.log",
  decisionLog: "decision_log.jsonl",
  executionLog: "execution_log.jsonl",
  x402CallLog: "logs/x402_calls.jsonl",
  positions: "positions.json",
  guardrails: "guardrail_state.json",
  priceCache: "price_cache.json",
  volumeCache: "volume_cache.json",
} as const;

export function sourceFile(sourcePath: string, fileName: string): string {
  return path.join(sourcePath, fileName);
}

export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<{ data: T; error?: string }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = redact(JSON.parse(raw));
    const result = schema.safeParse(parsed);

    if (result.success) {
      return { data: result.data };
    }

    return { data: fallback, error: result.error.issues[0]?.message ?? "Invalid JSON file" };
  } catch (error) {
    return { data: fallback, error: safeError(error) };
  }
}

export async function readLastLogLine(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const line = raw.split(/\r?\n/).filter(Boolean).at(-1);
    return line ? redact(line) : null;
  } catch {
    return null;
  }
}

export async function readLatestAgentLogLine(
  sourcePath: string,
): Promise<{ line: string | null; source: string | null; modifiedAt: string | null; modifiedAtMs: number | null }> {
  let best: { line: string; source: string; mtimeMs: number } | null = null;

  for (const fileName of AGENT_LOG_CANDIDATES) {
    const filePath = sourceFile(sourcePath, fileName);

    try {
      const stat = await fs.stat(filePath);
      const line = await readLastLogLine(filePath);

      if (!line) {
        continue;
      }

      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { line, source: fileName, mtimeMs: stat.mtimeMs };
      }
    } catch {
      continue;
    }
  }

  if (!best) {
    return { line: null, source: null, modifiedAt: null, modifiedAtMs: null };
  }

  return {
    line: best.line,
    source: best.source,
    modifiedAt: new Date(best.mtimeMs).toISOString(),
    modifiedAtMs: best.mtimeMs,
  };
}

export async function fileStatuses(sourcePath: string): Promise<Record<keyof typeof FILES, FileStatus>> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, fileName]) => {
      const filePath = sourceFile(sourcePath, fileName);

      try {
        const stat = await fs.stat(filePath);
        return [
          key,
          {
            path: filePath,
            exists: true,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          },
        ] as const;
      } catch (error) {
        return [
          key,
          {
            path: filePath,
            exists: false,
            sizeBytes: null,
            modifiedAt: null,
            error: safeError(error),
          },
        ] as const;
      }
    }),
  );

  return Object.fromEntries(entries) as Record<keyof typeof FILES, FileStatus>;
}
