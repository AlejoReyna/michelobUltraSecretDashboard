import { z } from "zod";
import type { StatusPayload } from "@/lib/schemas";

const DASHBOARD_VERSION = "0.1.0";
const MAX_DECISIONS = 10;
const MAX_EXECUTIONS = 5;
const MAX_MOVEMENTS = 5;

export const gptTelemetryContextSchema = z.object({
  meta: z.object({
    generatedAt: z.string(),
    dashboardVersion: z.string(),
    contextTruncated: z.boolean(),
  }),
  latestDecision: z
    .object({
      timestamp: z.string(),
      action: z.string(),
      confidence: z.number(),
      factors: z.record(z.string(), z.number()),
      targetAsset: z.string().optional(),
      reason: z.string().nullable().optional(),
      cycleNumber: z.number().nullable().optional(),
      entriesAllowed: z.boolean().nullable().optional(),
      pricedTargetCount: z.number().nullable().optional(),
    })
    .nullable(),
  decisions: z.array(
    z.object({
      timestamp: z.string(),
      action: z.string(),
      confidence: z.number(),
      symbol: z.string().nullable().optional(),
    }),
  ),
  executions: z.array(
    z.object({
      timestamp: z.string(),
      status: z.enum(["filled", "rejected", "pending"]),
      slippageBps: z.number().optional(),
      fromSymbol: z.string().nullable().optional(),
      toSymbol: z.string().nullable().optional(),
    }),
  ),
  positions: z.array(
    z.object({
      asset: z.string(),
      side: z.enum(["long", "short", "flat"]),
      size: z.number(),
      entryPrice: z.number(),
      unrealizedPnl: z.number().optional(),
    }),
  ),
  guardrails: z.object({
    dailyRealizedLossUsd: z.number().nullable(),
    dailyTradeCount: z.number().nullable(),
    portfolioAthUsd: z.number().nullable(),
    entriesBlocked: z.boolean(),
    halted: z.boolean(),
  }),
  wallet: z.object({
    chain: z.string(),
    portfolioTotalUsd: z.number().nullable(),
    nativeBalance: z.string().nullable(),
    tokenBalances: z.array(z.object({ symbol: z.string(), balance: z.string() })),
    recentMovements: z.array(
      z.object({
        type: z.enum(["in", "out", "x402_payment"]),
        amountUsd: z.number(),
        timestamp: z.string(),
        description: z.string(),
      }),
    ),
  }),
  health: z.object({
    botStatus: z.enum(["running", "stopped", "error"]),
    exporterStatus: z.enum(["connected", "degraded", "disconnected"]),
    lastBotHeartbeat: z.string().nullable(),
    lastLogLine: z.string().nullable(),
  }),
  x402: z.object({
    instrumented: z.boolean(),
    totalPaidUsd: z.number(),
    paymentCount: z.number(),
  }),
  files: z.object({
    priceCache: z.object({ exists: z.boolean(), modifiedAt: z.string(), sizeBytes: z.number() }),
    volumeCache: z.object({ exists: z.boolean(), modifiedAt: z.string(), sizeBytes: z.number() }),
    cmcPremiumDb: z.object({ exists: z.boolean(), modifiedAt: z.string(), sizeBytes: z.number() }),
  }),
});

export type GPTTelemetryContext = z.infer<typeof gptTelemetryContextSchema>;

type FileStatus = {
  exists?: boolean;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

function factorsFromScores(scores: StatusPayload["decisions"][number]["factor_scores"]): Record<string, number> {
  const factors: Record<string, number> = {};
  for (const [key, value] of Object.entries(scores ?? {})) {
    if (typeof value === "boolean") {
      factors[key] = value ? 1 : 0;
    }
  }
  return factors;
}

function confidenceFromDecision(decision: StatusPayload["decisions"][number]): number {
  if (typeof decision.true_factor_count === "number" && Number.isFinite(decision.true_factor_count)) {
    return decision.true_factor_count / 6;
  }
  const factors = factorsFromScores(decision.factor_scores);
  const values = Object.values(factors);
  if (values.length === 0) {
    return 0;
  }
  return values.filter((value) => value === 1).length / 6;
}

function executionStatus(execution: StatusPayload["executions"][number]): "filled" | "rejected" | "pending" {
  if (execution.error) {
    return "rejected";
  }
  if (execution.result || execution.tx_hash) {
    return "filled";
  }
  return "pending";
}

function slippageBps(execution: StatusPayload["executions"][number]): number | undefined {
  const pct = execution.max_slippage_pct;
  if (typeof pct === "number" && Number.isFinite(pct)) {
    return Math.round(pct * 10_000);
  }
  return undefined;
}

function isX402Movement(movement: StatusPayload["wallet"]["movements"][number]): boolean {
  const action = movement.action?.toLowerCase() ?? "";
  const provider = movement.provider?.toLowerCase() ?? "";
  return action.includes("x402") || provider.includes("x402");
}

function movementType(movement: StatusPayload["wallet"]["movements"][number]): "in" | "out" | "x402_payment" {
  if (isX402Movement(movement)) {
    return "x402_payment";
  }
  const action = movement.action?.toLowerCase() ?? "";
  if (action.includes("swap") || action.includes("entry")) {
    return "out";
  }
  return "in";
}

function movementDescription(movement: StatusPayload["wallet"]["movements"][number]): string {
  if (isX402Movement(movement)) {
    return "x402 CMC premium payment";
  }
  const from = movement.fromSymbol ?? "unknown";
  const to = movement.toSymbol ?? "unknown";
  return `${movement.action ?? "movement"}: ${from} → ${to}`;
}

function fileMeta(file: FileStatus | undefined) {
  return {
    exists: file?.exists ?? false,
    modifiedAt: file?.modifiedAt ?? "",
    sizeBytes: file?.sizeBytes ?? 0,
  };
}

function exporterStatus(payload: StatusPayload): "connected" | "degraded" | "disconnected" {
  const source = payload.connection?.source;
  if (source === "exporter" || source === "mock") {
    return "connected";
  }
  if (source === "error") {
    return "disconnected";
  }
  return "degraded";
}

function botStatus(payload: StatusPayload): "running" | "stopped" | "error" {
  if (payload.health.error) {
    return "error";
  }
  return payload.health.agentRunning ? "running" : "stopped";
}

function primaryChain(payload: StatusPayload): string {
  const chains = payload.wallet.balances.map((balance) => balance.chain);
  if (chains.includes("bsc")) {
    return "bsc";
  }
  return chains[0] ?? "unknown";
}

function nativeBalanceLabel(payload: StatusPayload): string | null {
  const bnb = payload.wallet.balances.find((balance) => balance.symbol === "BNB");
  if (bnb?.amount != null) {
    return `${bnb.amount} BNB`;
  }
  const usdc = payload.wallet.balances.find((balance) => balance.symbol === "USDC");
  if (usdc?.amount != null) {
    return `${usdc.amount} USDC`;
  }
  return null;
}

function x402PaymentStats(payload: StatusPayload) {
  const payments = payload.wallet.movements.filter(isX402Movement);
  const totalPaidUsd = payments.reduce((sum, payment) => {
    const amount = payment.amountIn;
    return sum + (typeof amount === "number" && Number.isFinite(amount) ? amount : 0);
  }, 0);

  return {
    totalPaidUsd,
    paymentCount: payload.x402.paidCallCount ?? payments.length,
  };
}

export function trimStatusPayload(payload: StatusPayload, options?: { decisionsTruncated?: boolean }): GPTTelemetryContext {
  const decisionsInput = payload.decisions;
  const contextTruncated = (options?.decisionsTruncated ?? decisionsInput.length > MAX_DECISIONS) || decisionsInput.length > MAX_DECISIONS;
  const decisions = decisionsInput.slice(-MAX_DECISIONS);

  const latest = payload.latestDecision;
  const latestDecision = latest
    ? {
        timestamp: latest.timestamp,
        action: latest.action,
        confidence: confidenceFromDecision(latest),
        factors: factorsFromScores(latest.factor_scores),
        targetAsset: latest.symbol ?? undefined,
        reason: latest.reason ?? null,
        cycleNumber: latest.cycle_number ?? null,
        entriesAllowed: latest.entries_allowed ?? null,
        pricedTargetCount: latest.priced_target_count ?? null,
      }
    : null;

  const executions = payload.executions.slice(-MAX_EXECUTIONS).map((execution) => ({
    timestamp: execution.timestamp,
    status: executionStatus(execution),
    slippageBps: slippageBps(execution),
    fromSymbol: execution.from_symbol ?? null,
    toSymbol: execution.to_symbol ?? null,
  }));

  const positions = payload.positions.positions.map((position) => ({
    asset: position.symbol,
    side: "long" as const,
    size: position.amount_tokens ?? 0,
    entryPrice: position.entry_price ?? 0,
    unrealizedPnl:
      position.entry_value_usdc != null && position.highest_price != null && position.entry_price != null
        ? (position.highest_price - position.entry_price) * (position.amount_tokens ?? 0)
        : undefined,
  }));

  const x402Stats = x402PaymentStats(payload);

  const context: GPTTelemetryContext = {
    meta: {
      generatedAt: payload.connection?.fetchedAt ?? payload.health.serverTime,
      dashboardVersion: DASHBOARD_VERSION,
      contextTruncated,
    },
    latestDecision,
    decisions: decisions.map((decision) => ({
      timestamp: decision.timestamp,
      action: decision.action,
      confidence: confidenceFromDecision(decision),
      symbol: decision.symbol ?? null,
    })),
    executions,
    positions,
    guardrails: {
      dailyRealizedLossUsd: payload.guardrails.daily_realized_loss ?? null,
      dailyTradeCount: payload.guardrails.daily_trade_count ?? null,
      portfolioAthUsd: payload.guardrails.portfolio_ath ?? null,
      entriesBlocked: latest?.entries_allowed === false,
      halted: latest?.action === "HALT",
    },
    wallet: {
      chain: primaryChain(payload),
      portfolioTotalUsd: payload.wallet.portfolioTotalUsd,
      nativeBalance: nativeBalanceLabel(payload),
      tokenBalances: payload.wallet.balances.map((balance) => ({
        symbol: balance.symbol,
        balance: balance.amount != null ? String(balance.amount) : "unknown",
      })),
      recentMovements: payload.wallet.movements.slice(-MAX_MOVEMENTS).map((movement) => ({
        type: movementType(movement),
        amountUsd: movement.amountIn ?? 0,
        timestamp: movement.timestamp ?? "",
        description: movementDescription(movement),
      })),
    },
    health: {
      botStatus: botStatus(payload),
      exporterStatus: exporterStatus(payload),
      lastBotHeartbeat: payload.health.lastLogModifiedAt ?? payload.health.serverTime,
      lastLogLine: payload.health.lastLogLine,
    },
    x402: {
      instrumented: payload.x402.instrumented ?? false,
      totalPaidUsd: x402Stats.totalPaidUsd,
      paymentCount: x402Stats.paymentCount,
    },
    files: {
      priceCache: fileMeta(payload.files.priceCache as FileStatus | undefined),
      volumeCache: fileMeta(payload.files.volumeCache as FileStatus | undefined),
      cmcPremiumDb: fileMeta(payload.files.cmcPremiumDb as FileStatus | undefined),
    },
  };

  return gptTelemetryContextSchema.parse(context);
}

export const CASCADE_INTEL_SYSTEM_PROMPT = `You are CASCADE INTEL — a read-only operator assistant for the Cascade AI trading dashboard.
You answer questions about live bot telemetry, decisions, executions, positions, guardrails,
wallet state, and x402 micropayments. You are NOT a financial advisor.

## GROUNDING RULES
- ONLY use the telemetry JSON provided in the user message below.
- NEVER hallucinate prices, balances, or market conditions.
- If the telemetry JSON is null or a field is missing, say you don't have that data.
- NEVER provide trade signals, entry/exit recommendations, or investment advice.
- NEVER suggest modifying bot parameters or bypassing guardrails.

## TONE & FORMAT
- Terminal aesthetic: concise, mono-spaced feel. Use \`>\` prefix on assistant lines.
- Dry, factual, slightly terse. No fluff.
- Preserve the existing dashboard disclaimer tone: "Gambling destroys."
- When discussing x402 payments, explain they pay for CMC premium data access.
- When discussing guardrails, emphasize they are safety limits, not suggestions.

## REFUSAL BEHAVIOR
- If asked for trade signals: "I cannot provide trade signals. I am a read-only telemetry assistant."
- If asked to predict prices: "I do not have live market data. I only report bot telemetry."
- If asked to modify the bot: "The dashboard is read-only. I cannot trigger actions."

## TELEMETRY SCHEMA
The JSON below is the ONLY source of truth for this turn.`;

export function buildTelemetryUserMessage(context: GPTTelemetryContext): string {
  return [
    "Current telemetry snapshot (read-only, refreshed server-side):",
    "---",
    JSON.stringify(context, null, 2),
    "---",
  ].join("\n");
}
