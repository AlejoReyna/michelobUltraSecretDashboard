import assert from "node:assert/strict";
import test from "node:test";
import type { Execution } from "../src/schemas.js";
import { TWAK_COMMAND_KEYS, type TwakCommandResult, type TwakTelemetry } from "../src/twak.js";
import { buildWalletTelemetry, movementFromExecution, normalizeTwakWallet } from "../src/wallet.js";

const SWAP_HASH = "0x2b5db498c97d6c69af6718872feb749457e7e6434c17569a34a2f78ff64eda94";
const APPROVAL_HASH = "0x5863c33ba5fbfd7016fae9dfe062d853213b198376862fd76ce81336a20fe7d0";
const WALLET_ADDRESS = "0x7CE28f5d2D1B2eFd8f87FF0a7fdC7D2EaB465c9c";

function command(data: unknown): TwakCommandResult {
  return { ok: true, data };
}

function failed(error: string): TwakCommandResult {
  return { ok: false, data: null, error };
}

function telemetry(overrides: Partial<TwakTelemetry> = {}): TwakTelemetry {
  const base = Object.fromEntries(TWAK_COMMAND_KEYS.map((key) => [key, command(null)])) as TwakTelemetry;
  return { ...base, ...overrides };
}

function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    timestamp: "2026-06-04T21:36:51.000Z",
    action: "entry",
    from_symbol: "USDC",
    to_symbol: "BNB",
    amount_in: 0.5,
    max_slippage_pct: 0.01,
    expected_amount_out: 0.000828458273533057,
    result: {
      mode: "twak",
      provider: "LiquidMesh",
      input: "0.5 USDC",
      output: "0.000828458273533057 BNB",
      explorer: `https://bscscan.com/tx/${SWAP_HASH}`,
      tx_hash: SWAP_HASH,
    },
    tx_hash: SWAP_HASH,
    approval_hash: APPROVAL_HASH,
    error: null,
    ...overrides,
  };
}

test("TWAK command failures become wallet errors without throwing", () => {
  const raw = Object.fromEntries(TWAK_COMMAND_KEYS.map((key) => [key, failed(`${key} failed safely`)])) as TwakTelemetry;

  const wallet = normalizeTwakWallet(raw, "2026-06-05T00:00:00.000Z");

  assert.equal(wallet.address, null);
  assert.equal(wallet.portfolioTotalUsd, null);
  assert.equal(wallet.balances.length, 0);
  assert.equal(wallet.movements.length, 0);
  assert.equal(wallet.errors.length, TWAK_COMMAND_KEYS.length);
  assert.equal(wallet.errors[0]?.source, "bscAddress");
});

test("portfolio array usdValue fields sum into portfolioTotalUsd", () => {
  const wallet = normalizeTwakWallet(
    telemetry({
      portfolio: command([
        { chain: "bsc", symbol: "USDC", usdValue: 7.11 },
        { chain: "base", symbol: "ETH", usdValue: 0.86 },
        { chain: "base", symbol: "USDC", usdValue: 0.5 },
      ]),
    }),
  );

  assert.equal(wallet.portfolioTotalUsd, 8.47);
});

test("execution log tx hashes become wallet movements", () => {
  const movement = movementFromExecution(execution());

  assert.equal(movement.source, "execution-log");
  assert.equal(movement.chain, "bsc");
  assert.equal(movement.txHash, SWAP_HASH);
  assert.equal(movement.approvalHash, APPROVAL_HASH);
  assert.equal(movement.explorerUrl, `https://bscscan.com/tx/${SWAP_HASH}`);
  assert.equal(movement.provider, "LiquidMesh");
  assert.equal(movement.fromSymbol, "USDC");
  assert.equal(movement.toSymbol, "BNB");
});

test("portfolio balances backfill chain balances when balance commands are empty", () => {
  const wallet = normalizeTwakWallet(
    telemetry({
      bscBalance: failed("NETWORK_ERROR"),
      portfolio: command([
        { chain: "bsc", symbol: "USDC", balance: "7.11", usdValue: 7.11 },
        { chain: "bsc", symbol: "AAVE", balance: "0.0055", usdValue: 0.4 },
        { chain: "base", symbol: "ETH", balance: "0.00055", usdValue: 0.86 },
      ]),
    }),
    "2026-06-05T00:00:00.000Z",
  );

  assert.equal(wallet.balances.length, 3);
  assert.equal(wallet.balances.find((balance) => balance.symbol === "AAVE")?.amount, 0.0055);
  assert.ok(wallet.portfolioTotalUsd !== null && Math.abs(wallet.portfolioTotalUsd - 8.37) < 0.01);
});

test("matching TWAK history and execution rows merge by tx hash", () => {
  const wallet = buildWalletTelemetry(
    telemetry({
      bscAddress: command({ address: WALLET_ADDRESS }),
      portfolio: command({ total_usd: 10.73 }),
      bscHistory: command([
        {
          timestamp: "2026-06-04T21:36:30.000Z",
          action: "swap",
          input: "0.5 USDC",
          output: "0.000828458273533057 BNB",
          hash: SWAP_HASH,
          provider: "LiquidMesh",
        },
      ]),
    }),
    [execution()],
    "2026-06-05T00:00:00.000Z",
  );

  assert.equal(wallet.address, WALLET_ADDRESS);
  assert.equal(wallet.portfolioTotalUsd, 10.73);
  assert.equal(wallet.movements.length, 1);
  assert.equal(wallet.movements[0]?.source, "merged");
  assert.equal(wallet.movements[0]?.txHash, SWAP_HASH);
  assert.equal(wallet.movements[0]?.approvalHash, APPROVAL_HASH);
});
