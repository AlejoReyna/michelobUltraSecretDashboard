import assert from "node:assert/strict";
import test from "node:test";
import { createMockStatus } from "@/lib/mock-data";
import { resolveMarketChatResponse } from "@/lib/market-chat-engine";

test("resolveMarketChatResponse returns scan summary for latest market scan query", () => {
  const data = createMockStatus();
  const response = resolveMarketChatResponse("What's the latest market scan?", data);

  assert.match(response, /Cycle #/);
  assert.match(response, /Entry score: 68\/100/);
  assert.match(response, /Factor audit/);
  assert.match(response, /Blocked reason: daily_trade_limit/);
});

test("resolveMarketChatResponse handles disconnected telemetry", () => {
  const response = resolveMarketChatResponse("What's the latest market scan?", null);
  assert.match(response, /Telemetry is disconnected/);
});
