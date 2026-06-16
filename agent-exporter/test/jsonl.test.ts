import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { decisionSchema } from "../src/schemas.js";
import { parseJsonlLines, readJsonlFile } from "../src/jsonl.js";
import { getMarketData, getX402Calls } from "../src/telemetry.js";

test("parseJsonlLines validates JSONL and skips malformed records", () => {
  const result = parseJsonlLines(
    [
      JSON.stringify({ timestamp: "2026-06-05T00:00:00Z", action: "WAIT" }),
      "{not json",
      JSON.stringify({ timestamp: "2026-06-05T00:01:00Z", action: "SELL" }),
      JSON.stringify({ timestamp: "2026-06-05T00:02:00Z", action: "ENTER", symbol: "BNB" }),
    ],
    decisionSchema,
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.errors.length, 2);
  assert.equal(result.items.at(-1)?.action, "ENTER");
});

test("readJsonlFile returns the latest requested validated entries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cascade-jsonl-"));
  const file = path.join(dir, "decision_log.jsonl");
  const lines = [
    { timestamp: "2026-06-05T00:00:00Z", action: "WAIT" },
    { timestamp: "2026-06-05T00:05:00Z", action: "BLOCKED" },
    { timestamp: "2026-06-05T00:10:00Z", action: "ENTER", symbol: "CAKE" },
  ].map((line) => JSON.stringify(line));

  await writeFile(file, `${lines.join("\n")}\n`, "utf8");

  const result = await readJsonlFile(file, decisionSchema, 2);

  assert.deepEqual(result.items.map((item) => item.action), ["BLOCKED", "ENTER"]);
  assert.equal(result.errors.length, 0);
});

test("getX402Calls reads x402 call logs from the logs directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cascade-x402-jsonl-"));
  const logsDir = path.join(dir, "logs");
  await mkdir(logsDir);
  await writeFile(
    path.join(logsDir, "x402_calls.jsonl"),
    [
      JSON.stringify({
        ts: "2026-06-14T18:02:11.123456+00:00",
        outcome: "success",
        tool: "get_crypto_quotes_latest",
        amount_usdc: 0.01,
        http_status: 200,
        reason: null,
        daily_spend_usdc: 0.01,
        total_spend_usdc: 0.01,
      }),
      JSON.stringify({
        ts: "2026-06-14T18:04:11.123456+00:00",
        outcome: "failure",
        tool: "get_crypto_market_metrics",
        amount_usdc: 0.01,
        http_status: null,
        reason: "payment rejected",
        daily_spend_usdc: 0.02,
        total_spend_usdc: 0.02,
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  const result = await getX402Calls(dir, 10);
  const missing = await getX402Calls(path.join(dir, "missing"), 10);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[1]?.outcome, "failure");
  assert.equal(result.errors.length, 0);
  assert.equal(missing.fileMissing, true);
});

test("getMarketData combines latest price and volume cache rows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cascade-market-cache-"));
  await writeFile(
    path.join(dir, "price_cache.json"),
    JSON.stringify({
      CAKE: [
        { timestamp: 1000, value: 10 },
        { timestamp: 1060, value: 11 },
      ],
      BNB: [{ timestamp: 1040, value: 650 }],
    }),
    "utf8",
  );
  await writeFile(
    path.join(dir, "volume_cache.json"),
    JSON.stringify({
      CAKE: [
        { timestamp: 1000, value: 500000 },
        { timestamp: 1060, value: 750000 },
      ],
      TWT: [{ timestamp: 1020, value: 120000 }],
    }),
    "utf8",
  );

  const result = await getMarketData(dir, 10);
  const cake = result.rows.find((row) => row.symbol === "CAKE");
  const twt = result.rows.find((row) => row.symbol === "TWT");

  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 3);
  assert.equal(cake?.price, 11);
  assert.equal(cake?.previousPrice, 10);
  assert.equal(cake?.priceChangePct, 10);
  assert.equal(cake?.volume, 750000);
  assert.equal(cake?.volumeChangePct, 50);
  assert.equal(cake?.source, "price_and_volume");
  assert.equal(twt?.source, "volume_cache");
});
