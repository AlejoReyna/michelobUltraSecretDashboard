import { promises as fs } from "node:fs";
import type { z } from "zod";
import { redact, safeError } from "./redact.js";

const DEFAULT_MAX_TAIL_BYTES = 512 * 1024;

export type JsonlParseResult<T> = {
  items: T[];
  errors: Array<{ line: number; error: string }>;
};

export async function readLastLines(
  filePath: string,
  limit: number,
  maxBytes = DEFAULT_MAX_TAIL_BYTES,
): Promise<string[]> {
  const stat = await fs.stat(filePath);
  if (stat.size === 0 || limit <= 0) {
    return [];
  }

  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let lines = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (start > 0) {
      lines = lines.slice(1);
    }

    return lines.slice(-limit);
  } finally {
    await handle.close();
  }
}

export function parseJsonlLines<T>(
  lines: string[],
  schema: z.ZodType<T>,
): JsonlParseResult<T> {
  const items: T[] = [];
  const errors: Array<{ line: number; error: string }> = [];

  for (const [index, line] of lines.entries()) {
    try {
      const parsed = redact(JSON.parse(line));
      const result = schema.safeParse(parsed);

      if (result.success) {
        items.push(result.data);
      } else {
        errors.push({ line: index + 1, error: result.error.issues[0]?.message ?? "Invalid JSONL object" });
      }
    } catch (error) {
      errors.push({ line: index + 1, error: safeError(error) });
    }
  }

  return { items, errors };
}

export async function readJsonlFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  limit: number,
): Promise<JsonlParseResult<T> & { fileMissing?: boolean }> {
  try {
    const lines = await readLastLines(filePath, limit);
    return parseJsonlLines(lines, schema);
  } catch (error) {
    if (isNotFound(error)) {
      return { items: [], errors: [], fileMissing: true };
    }

    return { items: [], errors: [{ line: 0, error: safeError(error) }] };
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
