import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPLIANCE_TRADE_LABEL,
  decisionFactorSummary,
  isComplianceDecision,
} from "./factor-scoring";
import { detailsFromDecision } from "./log-event-details";
import type { StatusPayload } from "./schemas";

type Decision = StatusPayload["decisions"][number];

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    timestamp: "2026-06-16T22:00:00+00:00",
    action: "ENTER",
    factor_scores: {},
    ...overrides,
  } as Decision;
}

test("isComplianceDecision detects source=daily_minimum", () => {
  assert.equal(isComplianceDecision(decision({ source: "daily_minimum" })), true);
  assert.equal(isComplianceDecision(decision({ source: "DAILY_MINIMUM" })), true);
});

test("isComplianceDecision detects factor_scores.daily_minimum", () => {
  assert.equal(
    isComplianceDecision(decision({ factor_scores: { daily_minimum: true } })),
    true,
  );
});

test("isComplianceDecision is false for a normal breakout decision", () => {
  assert.equal(
    isComplianceDecision(
      decision({ factor_scores: { volume_breakout: true }, true_factor_count: 1 }),
    ),
    false,
  );
});

test("daily_minimum compliance trade does NOT render as 1/6 factors", () => {
  // This is the bug: a compliance swap carries true_factor_count=1 and would
  // otherwise display as "1/6 factors".
  const d = decision({
    source: "daily_minimum",
    factor_scores: { daily_minimum: true },
    true_factor_count: 1,
    entry_score: null,
  });

  const summary = decisionFactorSummary(d);
  assert.equal(summary, COMPLIANCE_TRADE_LABEL);
  assert.doesNotMatch(summary, /\d+\s*\/\s*6/);

  const details = detailsFromDecision(d);
  const score = details.items.find((item) => item.label === "Entry score");
  assert.ok(score, "expected an Entry score row");
  assert.match(score!.value, /compliance/i);
  assert.doesNotMatch(score!.value, /\d+\s*\/\s*6/);
  // No misleading per-factor breakdown for a compliance swap.
  assert.equal((details.factors ?? []).length, 0);
});

test("breakout decision prefers entry_score over raw factor count", () => {
  const d = decision({
    strategy_mode: "breakout",
    entry_score: 52,
    factor_scores: { volume_breakout: true, slippage_under_cap: true },
    true_factor_count: 2,
  });
  assert.equal(decisionFactorSummary(d), "score 52/100");
});

test("breakout decision without entry_score still shows factor count", () => {
  const d = decision({
    strategy_mode: "breakout",
    entry_score: null,
    factor_scores: { volume_breakout: true },
    true_factor_count: 1,
  });
  assert.equal(decisionFactorSummary(d), "1/6 factors");
});
