import assert from "node:assert/strict";
import test from "node:test";
import { createMockStatus } from "@/lib/mock-data";
import { gptTelemetryContextSchema, trimStatusPayload } from "@/lib/market-chat-context";

test("trimStatusPayload passes gptTelemetryContextSchema on mock StatusPayload", () => {
  const payload = createMockStatus();
  const context = trimStatusPayload(payload);
  gptTelemetryContextSchema.parse(context);
  assert.equal(context.latestDecision?.entryScore, 68);
  assert.equal(context.latestDecision?.entriesBlockedReason, "daily_trade_limit");
  assert.equal(context.latestDecision?.confidence, 0.68);
});

test("trimStatusPayload redacts wallet address from GPT context", () => {
  const payload = createMockStatus();
  const context = trimStatusPayload(payload);
  const serialized = JSON.stringify(context);

  assert.ok(payload.wallet.address);
  assert.equal(serialized.includes(payload.wallet.address ?? ""), false);
  assert.equal("address" in context.wallet, false);
});

test("trimStatusPayload caps decisions at 10", () => {
  const payload = createMockStatus();
  const manyDecisions = Array.from({ length: 100 }, (_, index) => ({
    ...payload.decisions[0]!,
    timestamp: new Date(Date.now() - index * 60_000).toISOString(),
    cycle_number: index,
  }));

  const context = trimStatusPayload({
    ...payload,
    decisions: manyDecisions,
  });

  assert.equal(context.decisions.length, 10);
  assert.equal(context.meta.contextTruncated, true);
});
