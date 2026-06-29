import { z } from "zod";
import { FILES, fileStatuses, readJsonFile, sourceFile } from "./files.js";
import { getHealth } from "./health.js";
import { readJsonlFile } from "./jsonl.js";
import { redact } from "./redact.js";
import {
  decisionSchema,
  executionSchema,
  guardrailsSchema,
  hourlyPnlRecordSchema,
  marketDataRowSchema,
  positionsSchema,
  projectEndedSchema,
  sellHistorySchema,
  x402CallSchema,
  x402SpendLedgerSchema,
  x402WalletSchema,
  type Decision,
  type Execution,
  type Guardrails,
  type HourlyPnlRecord,
  type MarketDataRow,
  type Positions,
  type ProjectEnded,
  type SellHistoryRow,
  type X402Call,
  type X402SpendLedger,
  type X402Wallet,
} from "./schemas.js";
import { getTwakTelemetrySnapshot, requestTwakRefresh } from "./twak.js";
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

export async function getProjectEnded(sourcePath: string) {
  return readJsonFile<ProjectEnded>(sourceFile(sourcePath, FILES.projectEnded), projectEndedSchema, {
    projectEnded: false,
    endedAt: "",
  });
}

export async function getX402Calls(sourcePath: string, limit = DEFAULT_LIMIT) {
  return readJsonlFile<X402Call>(sourceFile(sourcePath, FILES.x402CallLog), x402CallSchema, limit);
}

export async function getX402SpendLedger(sourcePath: string) {
  return readJsonFile<X402SpendLedger>(
    sourceFile(sourcePath, FILES.x402SpendLedger),
    x402SpendLedgerSchema,
    {},
  );
}

export async function getX402Wallet(sourcePath: string) {
  return readJsonFile<X402Wallet>(
    sourceFile(sourcePath, FILES.x402Wallet),
    x402WalletSchema,
    {},
  );
}

export async function getSellHistory(sourcePath: string, limit = DEFAULT_LIMIT) {
  return readJsonlFile<SellHistoryRow>(sourceFile(sourcePath, FILES.sellHistoryLog), sellHistorySchema, limit);
}

export async function getHourlyPnl(sourcePath: string, limit = 500) {
  return readJsonlFile<HourlyPnlRecord>(sourceFile(sourcePath, FILES.hourlyPnlLog), hourlyPnlRecordSchema, limit);
}

export async function getPositions(sourcePath: string) {
  return readJsonFile<Positions>(sourceFile(sourcePath, FILES.positions), positionsSchema, { positions: [] });
}

export async function getGuardrails(sourcePath: string) {
  return readJsonFile<Guardrails>(sourceFile(sourcePath, FILES.guardrails), guardrailsSchema, {});
}

const cachePointSchema = z
  .object({
    timestamp: z.number(),
    value: z.number(),
  })
  .passthrough();

const marketCacheSchema = z.record(z.string(), z.array(cachePointSchema)).default({});

type CachePoint = z.infer<typeof cachePointSchema>;

function latestPair(points: CachePoint[] | undefined): [CachePoint | null, CachePoint | null] {
  const sorted = (points ?? [])
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .sort((left, right) => left.timestamp - right.timestamp);

  return [sorted.at(-1) ?? null, sorted.at(-2) ?? null];
}

function percentChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) {
    return null;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function isoFromUnixSeconds(timestamp: number | null): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

export async function getMarketData(sourcePath: string, limit = DEFAULT_LIMIT) {
  const [priceCache, volumeCache] = await Promise.all([
    readJsonFile<Record<string, CachePoint[]>>(sourceFile(sourcePath, FILES.priceCache), marketCacheSchema, {}),
    readJsonFile<Record<string, CachePoint[]>>(sourceFile(sourcePath, FILES.volumeCache), marketCacheSchema, {}),
  ]);

  const symbols = new Set([...Object.keys(priceCache.data), ...Object.keys(volumeCache.data)]);
  const rows: MarketDataRow[] = Array.from(symbols)
    .map((symbol) => {
      const [latestPrice, previousPrice] = latestPair(priceCache.data[symbol]);
      const [latestVolume, previousVolume] = latestPair(volumeCache.data[symbol]);
      const updatedTimestamp = Math.max(latestPrice?.timestamp ?? 0, latestVolume?.timestamp ?? 0);
      const hasPrice = latestPrice != null;
      const hasVolume = latestVolume != null;

      return marketDataRowSchema.parse({
        symbol,
        price: latestPrice?.value ?? null,
        previousPrice: previousPrice?.value ?? null,
        priceChangePct: percentChange(latestPrice?.value ?? null, previousPrice?.value ?? null),
        volume: latestVolume?.value ?? null,
        previousVolume: previousVolume?.value ?? null,
        volumeChangePct: percentChange(latestVolume?.value ?? null, previousVolume?.value ?? null),
        updatedAt: isoFromUnixSeconds(updatedTimestamp > 0 ? updatedTimestamp : null),
        source: hasPrice && hasVolume ? "price_and_volume" : hasPrice ? "price_cache" : "volume_cache",
      });
    })
    .sort((left, right) => {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      return rightTime - leftTime || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, limit);

  return {
    rows,
    errors: [priceCache.error, volumeCache.error].filter((error): error is string => Boolean(error)),
  };
}

export async function getWallet(sourcePath: string, limit = DEFAULT_LIMIT) {
  requestTwakRefresh("wallet");
  const twak = getTwakTelemetrySnapshot();

  const executions = await getExecutions(sourcePath, limit);

  return redact({
    balances: twak.telemetry,
    twakCache: twak.cache,
    wallet: buildWalletTelemetry(twak.telemetry, executions.items, twak.cache.refreshedAt ?? ""),
    executionErrors: executions.errors,
  });
}

export async function getStatus(sourcePath: string, limit = DEFAULT_LIMIT) {
  requestTwakRefresh("status");
  const twak = getTwakTelemetrySnapshot();

  const [health, decisions, executions, x402Calls, x402SpendLedger, x402Wallet, sellHistory, hourlyPnl, marketData, positions, guardrails, files, projectEnded] =
    await Promise.all([
      getHealth(sourcePath),
      getDecisions(sourcePath, limit),
      getExecutions(sourcePath, limit),
      getX402Calls(sourcePath, limit),
      getX402SpendLedger(sourcePath),
      getX402Wallet(sourcePath),
      getSellHistory(sourcePath, limit),
      getHourlyPnl(sourcePath),
      getMarketData(sourcePath, limit),
      getPositions(sourcePath),
      getGuardrails(sourcePath),
      fileStatuses(sourcePath),
      getProjectEnded(sourcePath),
    ]);

  return redact({
    health,
    latestDecision: decisions.items.at(-1) ?? null,
    decisions: decisions.items,
    decisionErrors: decisions.errors,
    latestExecution: executions.items.at(-1) ?? null,
    executions: executions.items,
    executionErrors: executions.errors,
    sellHistory: sellHistory.fileMissing ? [] : sellHistory.items,
    sellHistoryErrors: sellHistory.errors,
    hourlyPnl: hourlyPnl.fileMissing ? [] : hourlyPnl.items,
    positions: positions.data,
    positionsError: positions.error,
    guardrails: guardrails.data,
    guardrailsError: guardrails.error,
    balances: twak.telemetry,
    twakCache: twak.cache,
    wallet: buildWalletTelemetry(twak.telemetry, executions.items, twak.cache.refreshedAt ?? ""),
    x402: x402Calls.fileMissing
      ? {
          instrumented: false,
          paidCallCount: null,
          records: [],
          marketData: marketData.rows,
          marketDataErrors: marketData.errors,
          dailySpendUsdc: x402SpendLedger.data.daily_spend_usdc ?? null,
          totalSpendUsdc: x402SpendLedger.data.total_spend_usdc ?? null,
          dailyBudgetUsdc: 2.0,
          totalBudgetUsdc: 15.0,
          walletAddress: x402Wallet.data.address ?? null,
          walletUsdcBalance: x402Wallet.data.usdc_balance ?? null,
        }
      : {
          instrumented: true,
          paidCallCount: x402Calls.items.length,
          records: x402Calls.items,
          marketData: marketData.rows,
          marketDataErrors: marketData.errors,
          dailySpendUsdc: x402SpendLedger.data.daily_spend_usdc ?? null,
          totalSpendUsdc: x402SpendLedger.data.total_spend_usdc ?? null,
          dailyBudgetUsdc: 2.0,
          totalBudgetUsdc: 15.0,
          walletAddress: x402Wallet.data.address ?? null,
          walletUsdcBalance: x402Wallet.data.usdc_balance ?? null,
        },
    files,
    projectEnded: projectEnded.data.projectEnded ? projectEnded.data : null,
    projectEndedError: projectEnded.error,
  });
}
