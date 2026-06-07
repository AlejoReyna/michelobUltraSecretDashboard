import { redact } from "./redact.js";
import type { Execution, WalletBalance, WalletMovement, WalletTelemetry } from "./schemas.js";
import { TWAK_COMMAND_KEYS, type TwakCommandKey, type TwakTelemetry } from "./twak.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const TX_URL_RE = /https?:\/\/(?:www\.)?(?:bscscan\.com|basescan\.org)\/tx\/0x[a-fA-F0-9]{64}/i;
const APPROVAL_TX_RE = /approval tx:\s*(?:https?:\/\/(?:www\.)?(?:bscscan\.com|basescan\.org)\/tx\/)?(0x[a-fA-F0-9]{64})/i;

const ADDRESS_KEYS = ["address", "walletAddress", "wallet_address", "account"];
const SYMBOL_KEYS = ["symbol", "ticker", "asset", "currency", "token", "name"];
const TOKEN_ADDRESS_KEYS = ["tokenAddress", "token_address", "contractAddress", "contract_address", "contract"];
const AMOUNT_KEYS = ["amount", "balance", "quantity", "qty", "free", "available", "tokenBalance"];
const VALUE_USD_KEYS = ["valueUsd", "value_usd", "usdValue", "usd_value", "valueUSDC", "value_usdc"];
const PORTFOLIO_TOTAL_KEYS = [
  "portfolioTotalUsd",
  "portfolio_total_usd",
  "totalUsd",
  "total_usd",
  "totalUSDC",
  "total_usdc",
  "totalValueUsd",
  "total_value_usd",
  "portfolio_value_usdc",
];
const CONTAINER_KEYS = ["balances", "tokens", "assets", "holdings", "items", "data", "result", "results"];
const HISTORY_KEYS = ["history", "transactions", "movements", "activity", "items", "data", "result", "results"];
const TX_HASH_KEYS = ["txHash", "tx_hash", "transactionHash", "transaction_hash", "hash"];
const APPROVAL_HASH_KEYS = ["approvalHash", "approval_hash", "approvalTxHash", "approval_tx_hash"];
const TIMESTAMP_KEYS = ["timestamp", "createdAt", "created_at", "time", "date", "blockTime", "block_time", "datetime"];
const ACTION_KEYS = ["action", "type", "event", "method", "operation"];
const CHAIN_KEYS = ["chain", "network", "fromChain", "from_chain", "toChain", "to_chain"];
const EXPLORER_KEYS = ["explorer", "explorerUrl", "explorer_url", "txUrl", "tx_url", "url", "link"];
const INPUT_KEYS = ["input", "amountIn", "amount_in", "fromAmount", "from_amount"];
const OUTPUT_KEYS = ["output", "amountOut", "amount_out", "expectedAmountOut", "expected_amount_out"];
const PROVIDER_KEYS = ["provider", "router", "venue"];
const STATUS_KEYS = ["status", "state"];

const KEY_SKIP_FOR_BALANCE_MAP = new Set([
  "address",
  "account",
  "available",
  "balance",
  "balances",
  "chain",
  "currency",
  "data",
  "error",
  "holdings",
  "items",
  "network",
  "result",
  "results",
  "status",
  "symbol",
  "token",
  "tokens",
  "total",
  "value",
  "wallet",
  "walletaddress",
]);

function normalizedKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getField(record: Record<string, unknown>, keys: readonly string[]): unknown {
  const wanted = new Set(keys.map(normalizedKey));

  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizedKey(key))) {
      return value;
    }
  }

  return undefined;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.replaceAll(",", "").match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
    if (match) {
      const parsed = Number.parseFloat(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function directString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  return stringValue(getField(record, keys));
}

function directNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  return numberValue(getField(record, keys));
}

function findStringByKeys(value: unknown, keys: readonly string[], depth = 0): string | null {
  if (depth > 5) {
    return null;
  }

  if (isRecord(value)) {
    const direct = directString(value, keys);
    if (direct) {
      return direct;
    }

    for (const child of Object.values(value)) {
      const nested = findStringByKeys(child, keys, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      const nested = findStringByKeys(child, keys, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function sumPortfolioUsdValue(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  let sum = 0;
  let found = false;

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const usd = directNumber(item, VALUE_USD_KEYS);
    if (usd !== null) {
      sum += usd;
      found = true;
    }
  }

  return found ? sum : null;
}

function findNumberByKeys(value: unknown, keys: readonly string[], depth = 0): number | null {
  if (depth > 5) {
    return null;
  }

  if (isRecord(value)) {
    const direct = directNumber(value, keys);
    if (direct !== null) {
      return direct;
    }

    for (const child of Object.values(value)) {
      const nested = findNumberByKeys(child, keys, depth + 1);
      if (nested !== null) {
        return nested;
      }
    }
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      const nested = findNumberByKeys(child, keys, depth + 1);
      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

function findAddress(value: unknown): string | null {
  if (typeof value === "string" && ADDRESS_RE.test(value.trim())) {
    return value.trim();
  }

  const explicit = findStringByKeys(value, ADDRESS_KEYS);
  if (explicit && ADDRESS_RE.test(explicit)) {
    return explicit;
  }

  return null;
}

function cleanHash(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] ?? (HASH_RE.test(value) ? value : null);
}

function parseSymbolFromAmount(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parts = value.trim().split(/\s+/);
  const candidate = parts.at(-1);
  return candidate && /[a-z]/i.test(candidate) ? candidate.toUpperCase() : null;
}

function extractExplorerUrl(value: unknown): string | null {
  const direct = findStringByKeys(value, EXPLORER_KEYS);
  if (direct?.startsWith("http")) {
    return direct;
  }

  const text = collectStrings(value).join("\n");
  return text.match(TX_URL_RE)?.[0] ?? null;
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 5) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((child) => collectStrings(child, depth + 1));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((child) => collectStrings(child, depth + 1));
  }

  return [];
}

function extractApprovalHash(value: unknown): string | null {
  const direct = cleanHash(findStringByKeys(value, APPROVAL_HASH_KEYS));
  if (direct) {
    return direct;
  }

  const text = collectStrings(value).join("\n");
  return text.match(APPROVAL_TX_RE)?.[1] ?? null;
}

function inferChain(value: unknown, fallback: string): string {
  const direct = findStringByKeys(value, CHAIN_KEYS)?.toLowerCase();
  if (direct?.includes("base")) {
    return "base";
  }

  if (direct?.includes("bsc") || direct?.includes("bnb")) {
    return "bsc";
  }

  const text = collectStrings(value).join("\n").toLowerCase();
  if (text.includes("basescan") || text.includes("chain base")) {
    return "base";
  }

  if (text.includes("bscscan") || text.includes("chain bsc")) {
    return "bsc";
  }

  return fallback;
}

export function explorerUrlFor(chain: string, txHash: string | null | undefined): string | null {
  if (!txHash || !HASH_RE.test(txHash)) {
    return null;
  }

  if (chain.toLowerCase() === "base") {
    return `https://basescan.org/tx/${txHash}`;
  }

  if (chain.toLowerCase() === "bsc") {
    return `https://bscscan.com/tx/${txHash}`;
  }

  return null;
}

function addBalanceRow(rows: WalletBalance[], row: WalletBalance) {
  if (!row.symbol || row.symbol === "[REDACTED]") {
    return;
  }

  rows.push({
    ...row,
    symbol: row.symbol.toUpperCase(),
    tokenAddress: row.tokenAddress && ADDRESS_RE.test(row.tokenAddress) ? row.tokenAddress : row.tokenAddress ?? null,
  });
}

function collectBalanceRows(
  value: unknown,
  chain: string,
  rows: WalletBalance[],
  seen: WeakSet<object>,
  symbolHint?: string,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBalanceRows(item, chain, rows, seen);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  const symbol = directString(value, SYMBOL_KEYS) ?? symbolHint ?? null;
  const amount = directNumber(value, AMOUNT_KEYS);
  const valueUsd = directNumber(value, VALUE_USD_KEYS);
  const tokenAddress = directString(value, TOKEN_ADDRESS_KEYS);

  if (symbol && (amount !== null || valueUsd !== null)) {
    addBalanceRow(rows, {
      chain,
      symbol,
      amount,
      valueUsd,
      tokenAddress,
      raw: redact(value),
    });
  }

  for (const key of CONTAINER_KEYS) {
    const child = getField(value, [key]);
    if (child !== undefined) {
      collectBalanceRows(child, chain, rows, seen);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (KEY_SKIP_FOR_BALANCE_MAP.has(normalized) || CONTAINER_KEYS.map(normalizedKey).includes(normalized)) {
      continue;
    }

    const amountFromChild = numberValue(child);
    if (amountFromChild !== null && /^[a-z0-9_.-]{2,32}$/i.test(key)) {
      addBalanceRow(rows, {
        chain,
        symbol: key,
        amount: amountFromChild,
        raw: redact({ [key]: child }),
      });
      continue;
    }

    if (isRecord(child)) {
      collectBalanceRows(child, chain, rows, seen, key);
    }
  }
}

function normalizeBalancesForChain(twak: TwakTelemetry, key: "bscBalance" | "baseBalance", chain: string): WalletBalance[] {
  const result = twak[key];
  if (!result?.ok) {
    return [];
  }

  const rows: WalletBalance[] = [];
  collectBalanceRows(result.data, chain, rows, new WeakSet<object>());

  return rows;
}

function balanceRowKey(row: WalletBalance) {
  return `${row.chain.toLowerCase()}:${row.symbol.toUpperCase()}`;
}

function mergeBalanceRows(primary: WalletBalance[], fallback: WalletBalance[]): WalletBalance[] {
  const merged = [...primary];
  const seen = new Set(primary.map(balanceRowKey));

  for (const row of fallback) {
    const key = balanceRowKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(row);
  }

  return merged;
}

function normalizeBalancesFromPortfolio(twak: TwakTelemetry): WalletBalance[] {
  const result = twak.portfolio;
  if (!result?.ok || !Array.isArray(result.data)) {
    return [];
  }

  const rows: WalletBalance[] = [];

  for (const item of result.data) {
    if (!isRecord(item)) {
      continue;
    }

    const chain = directString(item, CHAIN_KEYS) ?? "unknown";
    const symbol = directString(item, SYMBOL_KEYS);
    const amount = directNumber(item, AMOUNT_KEYS);
    const valueUsd = directNumber(item, VALUE_USD_KEYS);
    const tokenAddress = directString(item, TOKEN_ADDRESS_KEYS);

    if (!symbol || (amount === null && valueUsd === null)) {
      continue;
    }

    addBalanceRow(rows, {
      chain,
      symbol,
      amount,
      valueUsd,
      tokenAddress,
      raw: redact(item),
    });
  }

  return rows;
}

function collectHistoryRows(value: unknown, rows: unknown[], seen: WeakSet<object>) {
  if (Array.isArray(value)) {
    rows.push(...value);
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  const hasMovementShape = Boolean(
    directString(value, TX_HASH_KEYS) ||
      directString(value, ACTION_KEYS) ||
      directString(value, TIMESTAMP_KEYS) ||
      directString(value, INPUT_KEYS) ||
      directString(value, OUTPUT_KEYS),
  );

  if (hasMovementShape) {
    rows.push(value);
  }

  for (const key of HISTORY_KEYS) {
    const child = getField(value, [key]);
    if (child !== undefined) {
      collectHistoryRows(child, rows, seen);
    }
  }
}

function twakHistoryMovement(row: unknown, fallbackChain: string): WalletMovement | null {
  if (!isRecord(row)) {
    return null;
  }

  const chain = inferChain(row, fallbackChain);
  const txHash = cleanHash(findStringByKeys(row, TX_HASH_KEYS));
  const approvalHash = extractApprovalHash(row);
  const input = scalarString(getField(row, INPUT_KEYS));
  const output = scalarString(getField(row, OUTPUT_KEYS));
  const status = directString(row, STATUS_KEYS) ?? directString(row, ["error"]);

  return {
    chain,
    timestamp: directString(row, TIMESTAMP_KEYS),
    action: directString(row, ACTION_KEYS) ?? (txHash ? "transaction" : "wallet activity"),
    fromSymbol: directString(row, ["fromSymbol", "from_symbol"]) ?? parseSymbolFromAmount(input),
    toSymbol: directString(row, ["toSymbol", "to_symbol"]) ?? parseSymbolFromAmount(output),
    amountIn: directNumber(row, ["amountIn", "amount_in", "amount"]) ?? numberValue(input),
    output,
    txHash,
    approvalHash,
    explorerUrl: extractExplorerUrl(row) ?? explorerUrlFor(chain, txHash),
    provider: directString(row, PROVIDER_KEYS),
    status,
    error: directString(row, ["error"]),
    source: "twak-history",
  };
}

function normalizeHistoryForChain(twak: TwakTelemetry, key: "bscHistory" | "baseHistory", chain: string): WalletMovement[] {
  const result = twak[key];
  if (!result?.ok) {
    return [];
  }

  const rows: unknown[] = [];
  collectHistoryRows(result.data, rows, new WeakSet<object>());

  return rows.flatMap((row) => {
    const movement = twakHistoryMovement(row, chain);
    return movement ? [movement] : [];
  });
}

export function normalizeTwakWallet(twak: TwakTelemetry, refreshedAt = new Date().toISOString()): WalletTelemetry {
  const errors = TWAK_COMMAND_KEYS.flatMap((key) => {
    const result = twak[key];
    return result && !result.ok && result.error ? [{ source: key, error: result.error }] : [];
  });

  return {
    address:
      findAddress(twak.bscAddress.data) ??
      findAddress(twak.baseAddress.data) ??
      findAddress(twak.portfolio.data),
    refreshedAt,
    portfolioTotalUsd:
      findNumberByKeys(twak.portfolio.data, PORTFOLIO_TOTAL_KEYS) ?? sumPortfolioUsdValue(twak.portfolio.data),
    balances: mergeBalanceRows(
      [
        ...normalizeBalancesForChain(twak, "bscBalance", "bsc"),
        ...normalizeBalancesForChain(twak, "baseBalance", "base"),
      ],
      normalizeBalancesFromPortfolio(twak),
    ),
    movements: [
      ...normalizeHistoryForChain(twak, "bscHistory", "bsc"),
      ...normalizeHistoryForChain(twak, "baseHistory", "base"),
    ],
    errors,
  };
}

function getExecutionField(execution: Execution, keys: readonly string[]): unknown {
  const topLevel = getField(execution as Record<string, unknown>, keys);
  if (topLevel !== undefined && topLevel !== null) {
    return topLevel;
  }

  if (isRecord(execution.result)) {
    return getField(execution.result, keys);
  }

  return undefined;
}

export function movementFromExecution(execution: Execution): WalletMovement {
  const valueForSearch = [execution, execution.result];
  const txHash =
    cleanHash(stringValue(execution.tx_hash ?? null)) ??
    cleanHash(stringValue(getExecutionField(execution, TX_HASH_KEYS)));
  const approvalHash =
    cleanHash(stringValue(execution.approval_hash ?? null)) ??
    cleanHash(stringValue(getExecutionField(execution, APPROVAL_HASH_KEYS))) ??
    extractApprovalHash(valueForSearch);
  const chain = inferChain(valueForSearch, "bsc");
  const input = scalarString(getExecutionField(execution, INPUT_KEYS));
  const output = scalarString(getExecutionField(execution, OUTPUT_KEYS));
  const error = stringValue(execution.error ?? null);
  const returnCode = numberValue(getExecutionField(execution, ["returncode", "returnCode"]));
  const status =
    error ??
    directString((execution as Record<string, unknown>), STATUS_KEYS) ??
    (returnCode === 0 || txHash ? "success" : "logged");

  return {
    chain,
    timestamp: execution.timestamp ?? null,
    action: execution.action ?? directString((execution as Record<string, unknown>), ACTION_KEYS) ?? "execution",
    fromSymbol:
      execution.from_symbol ??
      stringValue(getExecutionField(execution, ["fromSymbol", "from_symbol"])) ??
      parseSymbolFromAmount(input),
    toSymbol:
      execution.to_symbol ??
      stringValue(getExecutionField(execution, ["toSymbol", "to_symbol"])) ??
      parseSymbolFromAmount(output),
    amountIn: execution.amount_in ?? numberValue(getExecutionField(execution, ["amountIn", "amount_in"])) ?? numberValue(input),
    output,
    txHash,
    approvalHash,
    explorerUrl: extractExplorerUrl(valueForSearch) ?? explorerUrlFor(chain, txHash),
    provider: stringValue(getExecutionField(execution, PROVIDER_KEYS)),
    status,
    error,
    source: "execution-log",
  };
}

function hashKey(movement: WalletMovement): string | null {
  return movement.txHash ? movement.txHash.toLowerCase() : null;
}

function firstPresent<T>(preferred: T | null | undefined, fallback: T | null | undefined): T | null | undefined {
  return preferred ?? fallback;
}

function mergeMovement(twakMovement: WalletMovement, executionMovement: WalletMovement): WalletMovement {
  return {
    ...twakMovement,
    ...executionMovement,
    chain: firstPresent(executionMovement.chain, twakMovement.chain) ?? "bsc",
    timestamp: firstPresent(executionMovement.timestamp, twakMovement.timestamp) ?? null,
    action: firstPresent(executionMovement.action, twakMovement.action) ?? "transaction",
    fromSymbol: firstPresent(executionMovement.fromSymbol, twakMovement.fromSymbol),
    toSymbol: firstPresent(executionMovement.toSymbol, twakMovement.toSymbol),
    amountIn: firstPresent(executionMovement.amountIn, twakMovement.amountIn),
    output: firstPresent(executionMovement.output, twakMovement.output),
    txHash: firstPresent(executionMovement.txHash, twakMovement.txHash),
    approvalHash: firstPresent(executionMovement.approvalHash, twakMovement.approvalHash),
    explorerUrl: firstPresent(executionMovement.explorerUrl, twakMovement.explorerUrl),
    provider: firstPresent(executionMovement.provider, twakMovement.provider),
    status: firstPresent(executionMovement.status, twakMovement.status),
    error: firstPresent(executionMovement.error, twakMovement.error),
    source: "merged",
  };
}

export function mergeWalletMovements(
  twakMovements: WalletMovement[],
  executionMovements: WalletMovement[],
): WalletMovement[] {
  const merged = [...twakMovements];
  const byHash = new Map<string, number>();

  for (const [index, movement] of merged.entries()) {
    const key = hashKey(movement);
    if (key) {
      byHash.set(key, index);
    }
  }

  for (const movement of executionMovements) {
    const key = hashKey(movement);
    const existingIndex = key ? byHash.get(key) : undefined;

    if (existingIndex !== undefined) {
      merged[existingIndex] = mergeMovement(merged[existingIndex], movement);
      continue;
    }

    if (key) {
      byHash.set(key, merged.length);
    }
    merged.push(movement);
  }

  return merged.sort((left, right) => {
    const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
    const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export function buildWalletTelemetry(
  twak: TwakTelemetry,
  executions: Execution[],
  refreshedAt = new Date().toISOString(),
): WalletTelemetry {
  const twakWallet = normalizeTwakWallet(twak, refreshedAt);
  const executionMovements = executions.map(movementFromExecution);

  return {
    ...twakWallet,
    movements: mergeWalletMovements(twakWallet.movements, executionMovements),
  };
}
