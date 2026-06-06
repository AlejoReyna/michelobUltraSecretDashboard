import { FILES, fileStatuses, readJsonFile, sourceFile } from "./files.js";
import { getHealth } from "./health.js";
import { readJsonlFile } from "./jsonl.js";
import { redact } from "./redact.js";
import {
  decisionSchema,
  executionSchema,
  guardrailsSchema,
  positionsSchema,
  type Decision,
  type Execution,
  type Guardrails,
  type Positions,
} from "./schemas.js";
import { readTwakTelemetry } from "./twak.js";
import { buildWalletTelemetry } from "./wallet.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function parseLimit(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export async function getDecisions(sourcePath: string, limit = DEFAULT_LIMIT) {
  return readJsonlFile<Decision>(sourceFile(sourcePath, FILES.decisionLog), decisionSchema, limit);
}

export async function getExecutions(sourcePath: string, limit = DEFAULT_LIMIT) {
  return readJsonlFile<Execution>(sourceFile(sourcePath, FILES.executionLog), executionSchema, limit);
}

export async function getPositions(sourcePath: string) {
  return readJsonFile<Positions>(sourceFile(sourcePath, FILES.positions), positionsSchema, { positions: [] });
}

export async function getGuardrails(sourcePath: string) {
  return readJsonFile<Guardrails>(sourceFile(sourcePath, FILES.guardrails), guardrailsSchema, {});
}

export async function getStatus(sourcePath: string, limit = DEFAULT_LIMIT) {
  const [health, decisions, executions, positions, guardrails, balances, files] = await Promise.all([
    getHealth(sourcePath),
    getDecisions(sourcePath, limit),
    getExecutions(sourcePath, limit),
    getPositions(sourcePath),
    getGuardrails(sourcePath),
    readTwakTelemetry(),
    fileStatuses(sourcePath),
  ]);

  return redact({
    health,
    latestDecision: decisions.items.at(-1) ?? null,
    decisions: decisions.items,
    decisionErrors: decisions.errors,
    latestExecution: executions.items.at(-1) ?? null,
    executions: executions.items,
    executionErrors: executions.errors,
    positions: positions.data,
    positionsError: positions.error,
    guardrails: guardrails.data,
    guardrailsError: guardrails.error,
    balances,
    wallet: buildWalletTelemetry(balances, executions.items),
    x402: {
      instrumented: false,
      paidCallCount: null,
      records: [],
    },
    files,
  });
}
